# ComfyUI-PromptLora

**PromptLora** is a ComfyUI node that combines a text prompt editor, a LoRA browser, and CLIP text encoding in one place. Select LoRAs from a visual library instead of adding a separate loader node for each one.

## Features

- Browse LoRAs with image previews, folder filters, search, and favorites.
- Insert or remove LoRAs directly in the prompt, using tags such as `<lora:example:0.8>`.
- Automatically add available trigger words when selecting a LoRA.
- Adjust LoRA weights from the node without reopening the manager.
- View available LoRA metadata and edit activation text, preferred weight, and notes.
- Apply selected LoRAs to the model and CLIP, then produce positive conditioning.

## Installation

1. Download the repository ZIP and extract it to `ComfyUI/custom_nodes/ComfyUI-PromptLora/`, or clone the repository into `ComfyUI/custom_nodes/`.
2. Restart ComfyUI and refresh your browser.
3. Find **PromptLora** in the **conditioning** category.

No additional Python packages are required beyond a working ComfyUI installation.

## How to use

Connect the nodes as follows:

```text
Checkpoint Loader (MODEL) ──> PromptLora (MODEL) ──> KSampler (model)
Checkpoint Loader (CLIP)  ──> PromptLora (CLIP)
                             PromptLora (CONDITIONING) ──> KSampler (positive)
```

Enter your positive prompt in **PromptLora**. Open the LoRA Manager from the node to choose LoRAs. Clicking a LoRA adds its tag and any available trigger words to the prompt; clicking it again removes it. You can also type tags manually, for example:

```text
portrait, <lora:example:0.8>, detailed lighting
```

**Negative prompts:** use a separate CLIP Text Encode node connected to the KSampler's `negative` input. PromptLora supplies *positive* conditioning only.

## LoRA previews and metadata

Preview images are read from files next to each `.safetensors` LoRA, with matching names (for example `example.preview.png`, `example.png`, or `example.webp`).

When present, metadata may be read from the LoRA's safetensors header and nearby `.json`, `.metadata.json`, `.civitai.info`, or `.sq_lora.json` files. These additional files are **optional**. Saving edits in the LoRA information window writes a matching `.json` file next to the LoRA, so that folder must be writable.

Favorites are stored in the browser and do not change the LoRA model files.

## Notes

- The node type is `PromptLora` so existing workflows using that type remain compatible.
- LoRA tags must refer to LoRA files available in ComfyUI's configured LoRA directories.
- No Civitai extension or other LoRA manager is required.
