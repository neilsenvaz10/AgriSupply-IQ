# FASALYTICS intelligence service (FastAPI) - runtime image.
# Runtime dependencies come from requirements.txt, constrained by requirements.lock so every
# transitive package is pinned. No .env, credentials, datasets or model artifacts are copied in
# (see .dockerignore); model files are provided at run time via ML_MODEL_DIR.
FROM python:3.12.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt requirements.lock ./
RUN pip install -r requirements.txt -c requirements.lock

COPY app ./app

RUN useradd --system --uid 10001 --no-create-home fasalytics
USER fasalytics

EXPOSE 8000
CMD ["python", "-m", "app"]