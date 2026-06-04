from pathlib import Path

p = Path(__file__).resolve().parents[1] / ".env.example"
text = p.read_text(encoding="utf-8")
text = text.replace(
    "VITE_SIGNALING_URL=ws://localhost:3002/ws`r`nVITE",
    "VITE_SIGNALING_URL=ws://localhost:3002/ws\nVITE",
)
text = text.replace(
    "VITE_SIGNALING_URL=ws://localhost:3002\n",
    "VITE_SIGNALING_URL=ws://localhost:3002/ws\n",
)
p.write_text(text, encoding="utf-8")
print("fixed", p)
