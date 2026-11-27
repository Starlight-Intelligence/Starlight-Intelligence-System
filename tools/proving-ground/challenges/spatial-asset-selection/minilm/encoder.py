"""CPU encoder reused verbatim from the frozen offline retrieval smoke benchmark."""
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
FILES = {
    "onnx/model_quint8_avx2.onnx": "b941bf19f1f1283680f449fa6a7336bb5600bdcd5f84d10ddc5cd72218a0fd21",
    "tokenizer.json": "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
}


class Encoder:
    def __init__(self, path):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(str(path / "model_quint8_avx2.onnx"),
                                            sess_options=options, providers=["CPUExecutionProvider"])
        self.tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=256)
        self.tokenizer.no_padding()
        self.calls = 0

    def encode(self, text):
        tokenized = self.tokenizer.encode(text)
        inputs = {
            "input_ids": np.array([tokenized.ids], dtype=np.int64),
            "attention_mask": np.array([tokenized.attention_mask], dtype=np.int64),
            "token_type_ids": np.array([tokenized.type_ids], dtype=np.int64),
        }
        hidden = self.session.run(None, inputs)[0][0]
        self.calls += 1
        weights = inputs["attention_mask"][0].astype(np.float32)
        pooled = (hidden * weights[:, None]).sum(axis=0) / weights.sum()
        return pooled / np.linalg.norm(pooled)
