#!/bin/sh
# Trains ppe_ocrb in Docker from train/work/gt (node --experimental-strip-types train/lines.ts first)
# and writes train/work/ppe_ocrb.traineddata (integer, for tesseract.js), then copies it gzipped
# to .models/ppe_ocrb.traineddata.gz. MAX_ITERATIONS defaults to 6000.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
docker build -q -t ppe-mrz-train "$here" >/dev/null
docker run --rm -v "$here/work:/work" ppe-mrz-train sh -c "
  set -eu
  # Each line's box and lstmf, twelve at a time (tesstrain's Makefile makes them one by one).
  cd /tesstrain
  ls /work/gt/*.png | xargs -P 12 -I{} sh -c 'f={}; b=\${f%.png}; [ -s \$b.box ] || python3 generate_line_box.py -i \$f -t \$b.gt.txt > \$b.box; [ -s \$b.lstmf ] || tesseract \$f \$b --psm 7 lstm.train >/dev/null 2>&1'
  make training MODEL_NAME=ppe_ocrb START_MODEL=eng TESSDATA=/tessdata GROUND_TRUTH_DIR=/work/gt \
    DATA_DIR=/work/data PSM=7 MAX_ITERATIONS=${MAX_ITERATIONS:-6000} LEARNING_RATE=0.0001 \
    >/work/train.log 2>&1 || { tail -40 /work/train.log; exit 1; }
  lstmtraining --stop_training --convert_to_int \
    --continue_from /work/data/ppe_ocrb/checkpoints/ppe_ocrb_checkpoint \
    --traineddata /work/data/ppe_ocrb/ppe_ocrb.traineddata \
    --model_output /work/ppe_ocrb.traineddata
  grep -E 'BCER|At iteration' /work/train.log | tail -3
"
mkdir -p "$here/../.models"
gzip -9 -c "$here/work/ppe_ocrb.traineddata" > "$here/../.models/ppe_ocrb.traineddata.gz"
ls -l "$here/work/ppe_ocrb.traineddata" "$here/../.models/ppe_ocrb.traineddata.gz"
