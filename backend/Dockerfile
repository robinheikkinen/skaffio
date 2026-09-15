# Pin till bookworm för reproducerbara builds. Uppdatera tag + digest medvetet vid uppgradering.
# Hämta aktuell digest: docker pull python:3.12-slim-bookworm && docker inspect python:3.12-slim-bookworm --format '{{index .RepoDigests 0}}'
FROM python:3.12-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 ffmpeg && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /data/uploads
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
