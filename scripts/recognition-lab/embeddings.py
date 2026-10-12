"""Optional frozen SigLIP 2 / CLIP baseline. No training or image uploads.

Requires a separately prepared Python environment with torch, transformers, pillow.
Downloads model weights unless --local-only is used. Results are imported through
the lab CLI so dataset/model contracts are checked in one place.
"""
import argparse
import hashlib
import json
import math
import platform
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True)
    parser.add_argument("--checkpoint", default="google/siglip2-base-patch16-224")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--method", default="siglip2-text")
    parser.add_argument("--vocabulary", help="JSON array of {label, english, excluded}; defaults to run/vocabulary.json")
    parser.add_argument("--threshold", type=float, default=None, help="Optional uncalibrated cosine gate. Omit for naming-only comparison.")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.run) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", args.method):
        parser.error("Invalid run/method ID")
    if args.batch_size < 1 or args.batch_size > 128:
        parser.error("batch-size must be 1..128")
    if args.threshold is not None and (not math.isfinite(args.threshold) or not -1 <= args.threshold <= 1):
        parser.error("threshold must be in [-1,1]")
    root = Path(__file__).resolve().parents[2]
    folder = root / "eval" / "recognition" / args.run
    out = folder / f"{args.method}-import.json"
    if out.exists():
        parser.error("Output exists; use a new --method")
    dataset = json.loads((folder / "dataset.json").read_text(encoding="utf-8"))
    vocab_file = Path(args.vocabulary) if args.vocabulary else folder / "vocabulary.json"
    vocabulary_bytes = vocab_file.read_bytes()
    vocab = json.loads(vocabulary_bytes)
    if not isinstance(vocab, list) or not vocab or any(
        not isinstance(v, dict) or not isinstance(v.get("label"), str) or not v["label"].strip()
        or not isinstance(v.get("english"), str) or not v["english"].strip()
        or not isinstance(v.get("excluded"), bool) for v in vocab
    ) or not any(not v["excluded"] for v in vocab):
        parser.error("Invalid vocabulary")
    try:
        import torch
        import transformers
        from PIL import Image
        from transformers import AutoModel, AutoProcessor
    except ImportError:
        parser.error("Optional dependencies missing. Use a Python environment with torch, transformers and pillow; see docs/recognition-lab.md.")

    # This official CLIP checkpoint ships PyTorch weights. Avoid Transformers'
    # background download of a separately converted pull-request checkpoint.
    weight_options = {"use_safetensors": False} if args.checkpoint == "openai/clip-vit-base-patch32" else {}
    model = AutoModel.from_pretrained(args.checkpoint, revision=args.revision, local_files_only=args.local_only, **weight_options).to(args.device).eval()
    processor = AutoProcessor.from_pretrained(args.checkpoint, revision=args.revision, local_files_only=args.local_only)
    model_type = model.config.model_type
    if model_type not in ("siglip", "siglip2", "clip"):
        parser.error("Only SigLIP/SigLIP2/CLIP checkpoints are supported")
    def features(output):
        # Transformers 4 returns a Tensor; current 5 returns projected pooler_output.
        if torch.is_tensor(output):
            return output
        if hasattr(output, "pooler_output") and torch.is_tensor(output.pooler_output):
            return output.pooler_output
        raise ValueError("Unsupported feature result; verify the installed Transformers API")
    prompt = "a black line outline drawing of {} on a white background"
    texts = [prompt.format(v["english"]) for v in vocab]
    kwargs = {"padding": "max_length", "max_length": 64, "truncation": True} if model_type.startswith("siglip") else {"padding": True, "truncation": True}
    inputs = processor(text=texts, return_tensors="pt", **kwargs).to(args.device)
    with torch.inference_mode():
        text_features = features(model.get_text_features(**inputs))
        text_features = torch.nn.functional.normalize(text_features, dim=-1)
    predictions = []
    for start in range(0, len(dataset["candidates"]), args.batch_size):
        candidates = dataset["candidates"][start:start + args.batch_size]
        images = []
        for candidate in candidates:
            if not re.fullmatch(r"[A-Za-z0-9_-]+", candidate["id"]):
                parser.error("Invalid candidate ID")
            with Image.open(folder / "images" / (candidate["id"] + ".png")) as image:
                images.append(image.convert("RGB"))
        began = time.perf_counter()
        inputs = processor(images=images, return_tensors="pt").to(args.device)
        with torch.inference_mode():
            image_features = torch.nn.functional.normalize(features(model.get_image_features(**inputs)), dim=-1)
            similarities = (image_features @ text_features.T).cpu().tolist()
        latency = (time.perf_counter() - began) * 1000 / len(candidates)
        for candidate, scores in zip(candidates, similarities):
            ranked = sorted(range(len(vocab)), key=lambda i: scores[i], reverse=True)
            winner = next(i for i in ranked if not vocab[i]["excluded"])
            accepted = args.threshold is None or scores[winner] >= args.threshold
            predictions.append({"candidateId": candidate["id"], "label": vocab[winner]["label"],
                "accepted": accepted, "rawScore": scores[winner], "rankingScore": scores[winner],
                "topK": [{"label": vocab[i]["label"], "score": scores[i], "excluded": vocab[i]["excluded"]} for i in ranked[:5]],
                "latencyMs": latency, "reason": "uncalibrated cosine naming baseline; not a human probability"})
        print(f"{args.method}: {len(predictions)}/{len(dataset['candidates'])}")
    payload = {"schemaVersion": 1, "datasetId": dataset["id"], "datasetFingerprint": dataset["fingerprint"],
        "method": args.method, "model": args.checkpoint, "renderer": "outline224", "createdAt": datetime.now(timezone.utc).isoformat(),
        "metadata": {"revision": args.revision, "resolvedRevision": getattr(model.config, "_commit_hash", None),
            "python": platform.python_version(), "torch": torch.__version__, "transformers": transformers.__version__,
            "vocabularyHash": hashlib.sha256(vocabulary_bytes).hexdigest(), "prompt": prompt,
            "threshold": args.threshold, "calibrated": False, "device": args.device,
            "notes": "Frozen image-text cosine baseline. Prompt and vocabulary affect results. No claim of road-sketch superiority; no separate learned reject class."},
        "predictions": predictions}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Ready to import: npm run lab -- import --run {args.run} --file \"{out}\"")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"Experiment failed: {exc}", file=sys.stderr)
        sys.exit(1)
