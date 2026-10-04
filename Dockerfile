# The D3 App conformance suite as an image a product's CI runs against its test instance:
#   docker run --rm --network host ghcr.io/matdemers1/d3-app-conformance:contract-1 \
#     --base http://localhost:8080 --allow-http --product bindery --email … --password … --totp-secret …
FROM node:22-alpine
WORKDIR /contract
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY schema ./schema
COPY problems ./problems
COPY vectors ./vectors
COPY conformance ./conformance
COPY reference ./reference
USER node
ENTRYPOINT ["node", "/contract/conformance/cli.mjs"]
