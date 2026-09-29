FROM python:3.12-slim
# Optionnel : certificat d'un proxy d'entreprise qui inspecte le HTTPS (laisser vide sinon).
ARG EXTRA_CA_CERT=""
RUN if [ -n "$EXTRA_CA_CERT" ]; then \
      printf '%s\n' "$EXTRA_CA_CERT" > /usr/local/share/ca-certificates/extra-proxy.crt && update-ca-certificates && \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    fi
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt
# Ghostscript : mesure de la couverture d'encre (processus externe, voir docs/01-decisions.md).
# Sans lui, le contrôle fonctionne mais n'annonce pas la couverture d'encre.
ARG WITH_GHOSTSCRIPT=true
RUN if [ "$WITH_GHOSTSCRIPT" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ghostscript && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
COPY pyproject.toml ./
COPY flux_print ./flux_print
RUN pip install --no-cache-dir .
COPY config ./config
ENV FLUX_PRINT_CONFIG=/app/config
CMD ["flux-print", "worker"]
