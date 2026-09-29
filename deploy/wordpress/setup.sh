#!/bin/sh
# Installe WordPress + WooCommerce + Carte Blanche une seule fois (banc d'essai local).
set -e
cd /var/www/html
for i in $(seq 1 60); do [ -f wp-config.php ] && break; sleep 2; done
if ! wp core is-installed 2>/dev/null; then
  wp core install --url=http://localhost:8080 --title="Carte Blanche" --admin_user=atelier --admin_password=atelier \
    --admin_email=atelier@exemple.fr --skip-email
  wp language core install fr_FR --activate || true
  wp option update timezone_string "Europe/Paris"
fi
wp plugin is-installed woocommerce || wp plugin install woocommerce
wp plugin activate woocommerce
wp option update woocommerce_currency EUR
wp option update woocommerce_default_country "FR"
wp option update woocommerce_coming_soon no || true
wp plugin activate carte-blanche
wp carte-blanche demo || true
echo "Prêt : http://localhost:8080  (admin : atelier / atelier)"
