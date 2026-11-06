import json
import logging
import os
import re
import struct
from pathlib import Path
from urllib.parse import quote

import folder_paths
import comfy.sd
import comfy.utils
from aiohttp import web
from server import PromptServer

EXTENSION_DIR = Path(__file__).resolve().parent
LOGGER = logging.getLogger("PromptLora")

LORA_PATTERN = re.compile(r'<lora:([^:>]+)(?::([0-9.\-]+))?(?::([0-9.\-]+))?>')

def _resolve_lora_path(filename):
    if not filename.lower().endswith(".safetensors"):
        filename += ".safetensors"
    path = folder_paths.get_full_path("loras", filename)
    if path and os.path.isfile(path):
        return path
    target_name = Path(filename).name.lower()
    target_stem = Path(filename).stem.lower()
    try:
        all_loras = folder_paths.get_filename_list("loras")
    except Exception:
        return None
    for rel_path in all_loras:
        if Path(rel_path).name.lower() == target_name or Path(rel_path).stem.lower() == target_stem:
            path = folder_paths.get_full_path("loras", rel_path)
            if path and os.path.isfile(path):
                return path
    return None

def _read_json_file(path):
    if not os.path.exists(path): return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception: return {}

def _read_safetensors_metadata(filepath):
    try:
        with open(filepath, "rb") as f:
            len_bytes = f.read(8)
            if not len_bytes: return {}
            header_len = struct.unpack("<Q", len_bytes)[0]
            header_bytes = f.read(header_len)
            header = json.loads(header_bytes.decode("utf-8", errors="ignore"))
            meta = header.get("__metadata__", {})
            return meta if isinstance(meta, dict) else {}
    except Exception: return {}

def _read_lora_metadata(lora_file):
    base_path = os.path.splitext(lora_file)[0]
    data = {}
    data.update(_read_safetensors_metadata(lora_file))
    data.update(_read_json_file(base_path + ".metadata.json"))
    
    civitai_data = _read_json_file(base_path + ".civitai.info")
    if "trainedWords" in civitai_data:
        data["civitai_trained_words"] = civitai_data["trainedWords"]
    if "baseModel" in civitai_data:
        data["civitai_base_model"] = civitai_data["baseModel"]
    if "description" in civitai_data:
        data["civitai_description"] = civitai_data["description"]
    
    data.update(_read_json_file(base_path + ".json"))
    data.update(_read_json_file(base_path + ".sq_lora.json"))
    return data

def _trigger_words(metadata):
    value = metadata.get("activation text") or metadata.get("triggers")
    if not value and "civitai_trained_words" in metadata:
        value = metadata["civitai_trained_words"]
    if not value:
        value = (
            metadata.get("trigger_words") or metadata.get("activation_tags")
            or metadata.get("trainedWords") or metadata.get("trained_words")
            or metadata.get("activation_text") or metadata.get("modelspec.trigger_words")
        )
    if not value:
        freq = metadata.get("ss_tag_frequency")
        if isinstance(freq, str):
            try: freq = json.loads(freq)
            except Exception: pass
        if isinstance(freq, dict):
            tags = []
            for dataset in freq.values():
                if isinstance(dataset, dict):
                    sorted_tags = sorted(dataset.items(), key=lambda x: x[1], reverse=True)
                    tags.extend([k for k, v in sorted_tags if k not in ("[EOS]", "[BOS]")])
            if tags:
                return ", ".join(list(dict.fromkeys(tags))[:30])
    if not value: return ""
    if isinstance(value, str):
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            try:
                parsed = json.loads(value.replace("'", '"'))
                if isinstance(parsed, list): return ", ".join(str(x).strip() for x in parsed if str(x).strip())
            except Exception: pass
        return value
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return ""

def _extract_category(filename):
    parent = os.path.dirname(filename)
    return parent.replace("\\", "/") if parent else ""

def _find_preview_url(filename, full_path):
    stem = Path(full_path).with_suffix("")
    extensions = (".png", ".jpg", ".jpeg", ".webp", ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp")
    for extension in extensions:
        candidate = Path(str(stem) + extension)
        if candidate.is_file():
            return "/promptlora/preview?name=" + quote(filename, safe="")
    return ""

@PromptServer.instance.routes.get("/promptlora/loras")
async def smart_prompt_lora_list(request):
    results = []
    try:
        filenames = folder_paths.get_filename_list("loras")
    except Exception as exc:
        return web.json_response({"error": f"Error: {exc}"}, status=500)

    for filename in sorted(filenames, key=str.lower):
        if not filename.lower().endswith(".safetensors"): continue
        full_path = folder_paths.get_full_path("loras", filename)
        if not full_path or not os.path.isfile(full_path): continue
        
        metadata = _read_lora_metadata(full_path)
        tags = _trigger_words(metadata)
        
        try: 
            mtime = os.path.getmtime(full_path)
            size_mb = os.path.getsize(full_path) / (1024 * 1024)
        except OSError: 
            mtime = 0.0
            size_mb = 0.0
            
        results.append({
            "name": filename, "title": Path(filename).stem,
            "category": _extract_category(filename), "tags": tags,
            "preview_url": _find_preview_url(filename, full_path),
            "mtime": mtime, "file_size": round(size_mb, 2),
            "raw_meta": metadata 
        })
    return web.json_response({"loras": results})

@PromptServer.instance.routes.post("/promptlora/save_metadata")
async def smart_prompt_lora_save_metadata(request):
    try:
        data = await request.json()
        lora_name = data.get("name")
        if not lora_name: return web.json_response({"error": "No name"}, status=400)
        
        full_path = folder_paths.get_full_path("loras", lora_name)
        if not full_path or not os.path.isfile(full_path):
            return web.json_response({"error": "LoRA not found"}, status=404)
            
        base_path = os.path.splitext(full_path)[0]
        json_path = base_path + ".json"
        
        meta = _read_json_file(json_path)
        if "activation_text" in data: meta["activation text"] = str(data["activation_text"])
        if "preferred_weight" in data: 
            try: meta["preferred weight"] = float(data["preferred_weight"])
            except: pass
        if "negative_text" in data: meta["negative text"] = str(data["negative_text"])
        if "notes" in data: meta["notes"] = str(data["notes"])
        
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=4, ensure_ascii=False)
            
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@PromptServer.instance.routes.get("/promptlora/preview")
async def smart_prompt_lora_preview(request):
    filename = request.query.get("name", "")
    full_path = folder_paths.get_full_path("loras", filename)
    if not full_path or not os.path.isfile(full_path): raise web.HTTPNotFound()
    
    stem = Path(full_path).with_suffix("")
    extensions = (".png", ".jpg", ".jpeg", ".webp", ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp")
    for extension in extensions:
        candidate = Path(str(stem) + extension)
        if candidate.is_file(): return web.FileResponse(candidate)
    raise web.HTTPNotFound()

class PromptLoraNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": True}),
            }
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING")
    RETURN_NAMES = ("MODEL", "CONDITIONING")
    FUNCTION = "execute"
    CATEGORY = "conditioning"

    def execute(self, model, clip, prompt):
        matches = LORA_PATTERN.findall(prompt)
        clean_prompt = LORA_PATTERN.sub('', prompt).strip()
        clean_prompt = re.sub(r',\s*,', ',', clean_prompt)
        clean_prompt = re.sub(r'^\s*,\s*|\s*,\s*$', '', clean_prompt).strip()
        
        result_model = model
        result_clip = clip

        for match in matches:
            filename = match[0].strip()
            model_weight = float(match[1]) if match[1] else 1.0
            clip_weight = float(match[2]) if match[2] else model_weight

            if model_weight == 0 and clip_weight == 0: continue

            lora_file = _resolve_lora_path(filename)
            if not lora_file:
                LOGGER.warning(f"[PromptLora] LoRA not found: {filename}")
                continue

            try:
                lora = comfy.utils.load_torch_file(lora_file, safe_load=True)
                result_model, result_clip = comfy.sd.load_lora_for_models(result_model, result_clip, lora, model_weight, clip_weight)
                LOGGER.info(f"[PromptLora] Applied LoRA: {filename} (M:{model_weight}, C:{clip_weight})")
            except Exception as exc:
                LOGGER.error(f"[PromptLora] Failed to apply '{filename}': {exc}")

        LOGGER.info(f"[PromptLora] Final prompt (without LoRA tags): {clean_prompt}")
        tokens = result_clip.tokenize(clean_prompt)
        conditioning = result_clip.encode_from_tokens_scheduled(tokens)

        return (result_model, conditioning)

# Keep node identifiers stable for existing workflows.
NODE_CLASS_MAPPINGS = {"PromptLora": PromptLoraNode}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptLora": "PromptLora"}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]