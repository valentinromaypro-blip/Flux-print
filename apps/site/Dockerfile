FROM node:22-slim
# Optionnel : certificat d'un proxy d'entreprise qui inspecte le HTTPS (laisser vide sinon).
ARG EXTRA_CA_CERT=""
RUN if [ -n "$EXTRA_CA_CERT" ]; then printf '%s\n' "$EXTRA_CA_CERT" > /usr/local/share/extra-proxy.crt; fi
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/extra-proxy.crt
WORKDIR /app
COPY package.json package-lock.json ./
RUN touch /usr/local/share/extra-proxy.crt && npm ci --no-audit --no-fund
COPY . .
RUN npx next build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
