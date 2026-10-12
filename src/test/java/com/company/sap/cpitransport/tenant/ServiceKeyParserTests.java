package com.company.sap.cpitransport.tenant;

import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class ServiceKeyParserTests {
    private final ObjectMapper json = new ObjectMapper();
    private final ServiceKeyParser parser = new ServiceKeyParser();

    private ObjectNode valid() {
        ObjectNode input = json.createObjectNode();
        input.putObject("oauth").put("url", "https://tenant.example.localhost")
                .put("tokenurl", "https://auth.example.localhost/oauth/token")
                .put("clientid", "test-dummy-client").put("clientsecret", "test-dummy-secret");
        return input;
    }

    @Test
    @DisplayName("REQ-301 AC-1·AC-9 / REQ-305 AC-3: field mapping ignores extra fields and masks records")
    void req301_ac1_mapping() {
        ObjectNode input = valid();
        input.put("createdate", "ignored");
        ServiceKey key = parser.parse(input);
        assertThat(key).isEqualTo(new ServiceKey("https://tenant.example.localhost",
                "https://auth.example.localhost/oauth/token", "test-dummy-client", "test-dummy-secret"));
        assertThat(key.toString()).doesNotContain("test-dummy-client", "test-dummy-secret");
    }

    static Stream<String> fields() { return Stream.of("url", "tokenurl", "clientid", "clientsecret"); }

    @ParameterizedTest(name = "REQ-301 AC-2·AC-9 / REQ-305 AC-3: invalid field {0}")
    @MethodSource("fields")
    @DisplayName("REQ-301 AC-2·AC-9 / REQ-305 AC-3: missing numeric and empty values")
    void req301_ac2_fields(String field, CapturedOutput output) {
        for (int mode = 0; mode < 3; mode++) {
            ObjectNode input = valid();
            ObjectNode oauth = (ObjectNode) input.get("oauth");
            if (mode == 0) oauth.remove(field);
            if (mode == 1) oauth.put(field, 123);
            if (mode == 2) oauth.put(field, "");
            InvalidServiceKeyException error = catchThrowableOfType(() -> parser.parse(input), InvalidServiceKeyException.class);
            assertThat(error.getMessage()).isEqualTo("oauth." + field);
            assertThat(error.getCause()).isNull();
            assertThat(error.keys()).containsExactly("oauth." + field);
        }
        assertThat(output.getAll()).doesNotContain("test-dummy-client", "test-dummy-secret", "clientsecret\":");
    }

    @Test
    @DisplayName("REQ-301 AC-2·AC-9: absent or non-object oauth and service key list all keys in order")
    void req301_ac2_structure() {
        for (var input : List.of(json.createObjectNode(), json.createArrayNode(),
                json.createObjectNode().put("oauth", 1))) {
            assertThatThrownBy(() -> parser.parse(input)).hasMessage(
                    "oauth.url, oauth.tokenurl, oauth.clientid, oauth.clientsecret");
        }
        assertThatThrownBy(() -> parser.parse(null)).hasMessage(
                "oauth.url, oauth.tokenurl, oauth.clientid, oauth.clientsecret");
    }

    static Stream<String> urls() {
        return Stream.of("http://api.example.localhost", "ftp://localhost", "https:///missing",
                "not a uri", "http://localhost.example.localhost");
    }

    @ParameterizedTest(name = "REQ-301 AC-2·AC-9: rejected URL {0}")
    @MethodSource("urls")
    @DisplayName("REQ-301 AC-2·AC-9: invalid schemes hosts and syntax")
    void req301_ac2_urls(String url) {
        for (String field : List.of("url", "tokenurl")) {
            ObjectNode input = valid();
            ((ObjectNode) input.get("oauth")).put(field, url);
            assertThatThrownBy(() -> parser.parse(input)).hasMessage("oauth." + field);
        }
    }

    @Test
    @DisplayName("REQ-301 AC-2·AC-9: http permitted only on the two local hosts")
    void req301_ac2_local() {
        for (String host : List.of("localhost", "127.0.0.1")) {
            ObjectNode input = valid();
            ((ObjectNode) input.get("oauth")).put("url", "http://" + host + ":1")
                    .put("tokenurl", "http://" + host + ":1/oauth/token");
            assertThat(parser.parse(input).apiUrl()).isEqualTo("http://" + host + ":1");
        }
    }

    @Test
    @DisplayName("REQ-301 AC-2·AC-9 / REQ-305 AC-3: token suffix emits one address-free warning")
    void req301_ac2_suffix(CapturedOutput output) {
        ObjectNode input = valid();
        ((ObjectNode) input.get("oauth")).put("tokenurl", "https://auth.example.localhost///");
        assertThat(parser.parse(input).tokenUrl()).isEqualTo("https://auth.example.localhost/oauth/token");
        parser.parse(valid());
        assertThat(output.getAll().split("tokenurl에 /oauth/token을 붙였습니다", -1)).hasSize(2);
        assertThat(output.getAll()).doesNotContain("auth.example.localhost", "test-dummy-client", "test-dummy-secret");
    }
}
