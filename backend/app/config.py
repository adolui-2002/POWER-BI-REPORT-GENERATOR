import os
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", 25))
MAX_ROWS = int(os.getenv("MAX_ROWS", 200_000))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", 120))
ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
