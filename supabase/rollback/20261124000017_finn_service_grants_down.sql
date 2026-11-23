-- Rolls back migration 17: takes the server's service role off the Finn tables again.
revoke select, update on budgetbuddy.finn_prefs from service_role;
revoke select, update, delete on budgetbuddy.whatsapp_links from service_role;
revoke select, insert on budgetbuddy.whatsapp_seen from service_role;
revoke select, update on budgetbuddy.finn_messages from service_role;
