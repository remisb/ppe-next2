# Trains ppe_ocrb (docs-import plan, phase 1): tessdata_best's eng fine-tuned on
# synthetic OCR-B MRZ lines (lines.ts) with tesstrain. Tesseract 5.5 from Debian,
# with its training tools; tesstrain and eng at fixed commits.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr make python3 python3-pil git ca-certificates wget bc \
 && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/tesseract-ocr/tesstrain /tesstrain && git -C /tesstrain checkout 405346a3a67d8e4e049341d1da6a4b752e0b8351
RUN mkdir -p /tessdata && wget -q -O /tessdata/eng.traineddata \
    https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/9ddc24e750eec0994223a9edc3fcb434a2244f3b/eng.traineddata \
 && cp /usr/share/tesseract-ocr/5/tessdata/configs/* /tessdata/ 2>/dev/null; true
WORKDIR /tesstrain
