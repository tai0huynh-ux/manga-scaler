# ONNX models

Install the production model artifacts here using the exact configured filenames:

- `anime_x2.onnx`
- `anime_x4.onnx`
- `general_x4.onnx`

Models must accept float32 RGB NCHW input and return float32 RGB NCHW output at their configured scale. Model binaries are intentionally not committed to this source repository.

`anime_x4.onnx` is downloaded automatically from the configured Hugging Face URL and verified against its pinned SHA-256. Delete the local file only when you intentionally want the service to fetch a fresh verified copy on the next load.
