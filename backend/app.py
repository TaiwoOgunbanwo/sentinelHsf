import os
import sqlite3
import ssl
import importlib
import sys
from flask import Flask, request, jsonify

try:
    from flask_cors import CORS
except ModuleNotFoundError:  # pragma: no cover
    def CORS(app, *_, **__):
        print("Warning: flask-cors not installed; continuing without CORS support.")
        return app


def import_required(module_name: str, install_hint: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise RuntimeError(
            f"Required dependency '{module_name}' is not installed. "
            f"Install it with `{install_hint}` before running the server."
        ) from exc


torch = None
try:
    torch = importlib.import_module("torch")
except ModuleNotFoundError:  # pragma: no cover
    print("Warning: PyTorch not installed; ONNX runtime will default to CPU.")

transformers = import_required("transformers", "pip install transformers")
AutoTokenizer = transformers.AutoTokenizer

optimum_onnx = import_required(
    "optimum.onnxruntime", "pip install 'optimum[onnxruntime]'"
)
ORTModelForSequenceClassification = optimum_onnx.ORTModelForSequenceClassification
pipeline = optimum_onnx.pipeline

print("--- API Server Starting Up ---")

# --- Paths & Database Setup ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "reports.db")


def init_db():
    """Ensure the reports database and table exist."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                text TEXT NOT NULL,
                report_type TEXT NOT NULL
            )
            """
        )
        conn.commit()


def save_report(text: str, report_type: str):
    """Persist a feedback report."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO reports (text, report_type) VALUES (?, ?)",
            (text, report_type),
        )
        conn.commit()


# --- Initialize Flask App ---
app = Flask(__name__)
app.config["CORS_HEADERS"] = "Content-Type"
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)

# Initialize the database before loading the model.
init_db()

# --- Load ONNX Model from Hugging Face Hub ---
REPO_ID = "TaiwoOgun/deberta-v3-hate-speech-onnx"

print(f"Loading model: {REPO_ID}...")
try:
    model = ORTModelForSequenceClassification.from_pretrained(REPO_ID)
    tokenizer = AutoTokenizer.from_pretrained(REPO_ID)

    device = 0 if torch.cuda.is_available() else -1
    device_name = "GPU" if device == 0 else "CPU"

    classifier = pipeline(
        "text-classification",
        model=model,
        tokenizer=tokenizer,
        device=device,
    )
    print(f"✅ Model loaded successfully on device: {device_name}")

except Exception as e:
    print(f"FATAL ERROR: Could not load model from Hub. {e}")
    classifier = None


# --- Prediction Endpoints ---
@app.route("/predict", methods=["POST", "OPTIONS"])
def predict():
    if request.method == "OPTIONS":
        return ("", 204)

    if not classifier:
        return jsonify({"error": "Model is not loaded."}), 500

    try:
        data = request.get_json()
        text_to_check = data["text"]
        if not isinstance(text_to_check, str):
            raise ValueError
    except Exception:
        return jsonify({"error": "Invalid JSON: 'text' field missing or not a string."}), 400

    try:
        prediction = classifier(text_to_check)[0]
        label_map = {"LABEL_0": "NOT_HATE", "LABEL_1": "HATE"}
        result = {
            "label": label_map.get(prediction["label"], "UNKNOWN"),
            "score": round(prediction["score"], 4),
        }
        return jsonify(result)
    except Exception as e:
        print(f"Error during prediction: {e}")
        return jsonify({"error": "Model inference failed."}), 500


@app.route("/predict/batch", methods=["POST", "OPTIONS"])
def predict_batch():
    if request.method == "OPTIONS":
        return ("", 204)

    if not classifier:
        return jsonify({"error": "Model is not loaded."}), 500

    try:
        data = request.get_json()
        texts = data.get("texts")
        if not isinstance(texts, list) or not texts:
            raise ValueError
        sanitized_texts = []
        for text in texts:
            if not isinstance(text, str):
                raise ValueError
            sanitized_texts.append(text)
    except Exception:
        return jsonify(
            {"error": "Invalid JSON: 'texts' must be a non-empty list of strings."}
        ), 400

    try:
        predictions = classifier(sanitized_texts)
        label_map = {"LABEL_0": "NOT_HATE", "LABEL_1": "HATE"}
        results = []
        for prediction in predictions:
            results.append(
                {
                    "label": label_map.get(prediction.get("label"), "UNKNOWN"),
                    "score": round(float(prediction.get("score", 0.0)), 4),
                }
            )
        return jsonify({"results": results})
    except Exception as e:
        print(f"Error during batch prediction: {e}")
        return jsonify({"error": "Batch model inference failed."}), 500


# --- Feedback Endpoint ---
@app.route("/report", methods=["POST", "OPTIONS"])
def report():
    if request.method == "OPTIONS":
        return ("", 204)

    try:
        data = request.get_json()
        text = data.get("text")
        report_type = data.get("report_type")
        if not isinstance(text, str) or not isinstance(report_type, str):
            raise ValueError
    except Exception:
        return jsonify({"error": "Invalid JSON: expect 'text' and 'report_type' strings."}), 400

    try:
        save_report(text, report_type)
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        print(f"Error saving report: {e}")
        return jsonify({"error": "Unable to save report."}), 500


# --- HTTPS Server Startup ---
if __name__ == "__main__":

    @app.after_request
    def apply_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        return response

    if os.getenv("SENTINEL_HTTP_ONLY") == "1":
        print("SENTINEL_HTTP_ONLY=1 set; serving plain HTTP on http://localhost:5000")
        app.run(debug=True, host="0.0.0.0", port=5000)
        sys.exit(0)

    custom_cert = os.getenv("SENTINEL_CERT_FILE")
    custom_key = os.getenv("SENTINEL_KEY_FILE")
    if custom_cert and custom_key and os.path.exists(custom_cert) and os.path.exists(custom_key):
        ssl_context = (custom_cert, custom_key)
        print(
            f"Using SSL certificate supplied via environment:\n"
            f"  SENTINEL_CERT_FILE={custom_cert}\n"
            f"  SENTINEL_KEY_FILE={custom_key}"
        )
        app.run(debug=True, host="0.0.0.0", port=5000, ssl_context=ssl_context)
        sys.exit(0)

    print("Creating self-signed SSL certificate...")
    try:
        from OpenSSL import crypto

        pkey = crypto.PKey()
        pkey.generate_key(crypto.TYPE_RSA, 2048)
        x509 = crypto.X509()
        subj = x509.get_subject()
        subj.CN = "localhost"
        x509.set_serial_number(1000)
        x509.gmtime_adj_notBefore(0)
        x509.gmtime_adj_notAfter(10 * 365 * 24 * 60 * 60)
        x509.set_issuer(subj)
        x509.set_pubkey(pkey)

        san_entries = [b"DNS:localhost", b"IP:127.0.0.1", b"IP:::1"]
        x509.add_extensions(
            [
                crypto.X509Extension(b"basicConstraints", False, b"CA:FALSE"),
                crypto.X509Extension(b"keyUsage", True, b"digitalSignature,keyEncipherment"),
                crypto.X509Extension(b"extendedKeyUsage", False, b"serverAuth"),
                crypto.X509Extension(b"subjectAltName", False, b", ".join(san_entries)),
            ]
        )
        x509.sign(pkey, "sha256")

        cert_dir = os.path.join(os.path.expanduser("~"), ".finalextension")
        os.makedirs(cert_dir, exist_ok=True)

        cert_file = os.path.join(cert_dir, "localhost-cert.pem")
        key_file = os.path.join(cert_dir, "localhost-key.pem")

        if not os.path.exists(cert_file) or not os.path.exists(key_file):
            with open(cert_file, "wt") as f:
                f.write(crypto.dump_certificate(crypto.FILETYPE_PEM, x509).decode("utf-8"))
            with open(key_file, "wt") as f:
                f.write(crypto.dump_privatekey(crypto.FILETYPE_PEM, pkey).decode("utf-8"))
            print(f"Generated new TLS certificate at {cert_dir}")
        else:
            print(f"Using existing TLS certificate at {cert_dir}")

        ssl_context = (cert_file, key_file)

        print("✅ SSL certificate created. Starting server on https://localhost:5000")
        app.run(debug=True, host="0.0.0.0", port=5000, ssl_context=ssl_context)

    except ImportError:
        print("Error: 'pyOpenSSL' not found. Please install it with 'pip install pyOpenSSL'")
        print("Falling back to HTTP. This will not work on HTTPS sites.")
        app.run(debug=True, host="0.0.0.0", port=5000)
    except Exception as e:
        print(f"Error starting SSL server: {e}")
        print("Falling back to HTTP.")
        app.run(debug=True, host="0.0.0.0", port=5000)
