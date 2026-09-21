"""Validate synthetic regression PDFs exported by check-windows-webview.ts.

Usage: python scripts/check-regression-pdfs.py <fixture-directory> <report-directory>
Development dependencies: pypdf, pdfplumber. Does not modify source files.
"""
from pathlib import Path
import json
import sys
import pdfplumber
from pypdf import PdfReader

fixtures, output = map(Path, sys.argv[1:])
expected = json.loads((fixtures / "expected.json").read_text(encoding="utf-8"))
report = json.loads((output / "report.json").read_text(encoding="utf-8"))
results = []
for index, item in enumerate(report["batch"]):
    name = Path(item["path"]).name
    if item["state"] == "failed":
        continue
    path = output / f"{index}-{name}.pdf" if item["generated"] else Path(item["path"])
    pdf = PdfReader(path)
    text = "\n".join(page.extract_text() for page in pdf.pages)
    spec = expected.get(name, {})
    missing = [marker for marker in spec.get("markers", []) if marker not in text]
    assert not missing, f"{name}: missing {len(missing)} markers: {missing[:20]}"
    if "pages" in spec:
        assert len(pdf.pages) == spec["pages"], f"{name}: unexpected page count {len(pdf.pages)}"
    outside = []
    images = 0
    with pdfplumber.open(path) as document:
        for number, page in enumerate(document.pages):
            images += len(page.images)
            for char in page.chars:
                if (char["x0"] < -1 or char["x1"] > page.width + 1
                        or char["top"] < -1 or char["bottom"] > page.height + 1):
                    outside.append((number + 1, char["text"]))
    assert not outside, f"{name}: text outside page: {outside[:20]}"
    assert images >= spec.get("minImages", 0), f"{name}: missing images"
    results.append({"source": name, "pages": len(pdf.pages), "bytes": path.stat().st_size,
                    "images": images,
                    "markers": len(spec.get("markers", [])), "outsidePageCharacters": len(outside),
                    "sizes": [[float(p.mediabox.width), float(p.mediabox.height)] for p in pdf.pages]})
(output / "pdf-validation.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(results, ensure_ascii=False, indent=2))
