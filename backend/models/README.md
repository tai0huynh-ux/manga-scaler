# ONNX models

Install the production model artifacts here using the exact configured filenames:

- `anime_x2.onnx`
- `anime_x4.onnx`
- `general_x4.onnx`

Models must accept float32 RGB NCHW input and return float32 RGB NCHW output at their configured scale. Model binaries are intentionally not committed to this source repository.

`anime_x4.onnx` and `general_x4.onnx` are downloaded automatically from their configured Hugging Face URLs and verified against pinned SHA-256 values. The general photo model has a fixed 64×64 input, which the runtime detects and tiles automatically. Delete a local file only when you intentionally want the service to fetch a fresh verified copy on the next load.
