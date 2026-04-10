FROM python:3.12-slim

WORKDIR /app

# Install dependencies (cached layer)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Source code is mounted via volume — no COPY needed in dev
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
