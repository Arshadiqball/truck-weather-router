#!/usr/bin/env bash
# Build step for the hosted app: API dependencies, then the React bundle
# that Django serves from frontend/dist.
set -o errexit

pip install -r backend/requirements.txt

cd frontend
npm ci
npm run build
