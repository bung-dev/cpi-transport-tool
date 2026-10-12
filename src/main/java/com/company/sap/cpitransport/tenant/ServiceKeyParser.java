package com.company.sap.cpitransport.tenant;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;

public class ServiceKeyParser {
    private static final Logger LOG = LoggerFactory.getLogger(ServiceKeyParser.class);
    private static final List<String> FIELDS = List.of("url", "tokenurl", "clientid", "clientsecret");

    public ServiceKey parse(JsonNode input) {
        JsonNode oauth = input != null && input.isObject() ? input.get("oauth") : null;
        List<String> invalid = new ArrayList<>();
        String[] values = new String[4];
        for (int i = 0; i < FIELDS.size(); i++) {
            JsonNode node = oauth != null && oauth.isObject() ? oauth.get(FIELDS.get(i)) : null;
            if (node == null || !node.isString() || node.asString().isEmpty()) {
                invalid.add("oauth." + FIELDS.get(i));
            } else {
                values[i] = node.asString();
                if (i < 2 && !validUrl(values[i])) invalid.add("oauth." + FIELDS.get(i));
            }
        }
        if (!invalid.isEmpty()) throw new InvalidServiceKeyException(invalid);
        if (!values[1].endsWith("/oauth/token")) {
            values[1] = values[1].replaceAll("/+$", "") + "/oauth/token";
            LOG.warn("tokenurl에 /oauth/token을 붙였습니다");
        }
        return new ServiceKey(values[0], values[1], values[2], values[3]);
    }

    private boolean validUrl(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            return host != null && ("https".equalsIgnoreCase(uri.getScheme())
                    || "http".equalsIgnoreCase(uri.getScheme())
                    && ("localhost".equals(host) || "127.0.0.1".equals(host)));
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }
}
