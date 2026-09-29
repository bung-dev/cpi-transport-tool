package com.company.sap.cpitransport.stub;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.regex.Pattern;
import java.util.zip.ZipInputStream;

/** Inspects the local WireMock request journal without contacting a CPI tenant. */
public final class UploadedArtifactExtractor {
    private static final String ROOT = "/api/v1/IntegrationDesigntimeArtifacts";
    private static final Pattern UPDATE = Pattern.compile(Pattern.quote(ROOT)
            + "\\(Id='([A-Za-z0-9_.-]{1,100})',Version='[^']+'\\)");

    private UploadedArtifactExtractor() {}

    public static void main(String[] args) throws Exception {
        if (args.length > 1) throw new IllegalArgumentException("Usage: UploadedArtifactExtractor [prd-port]");
        int port = args.length == 0 ? 18082 : Integer.parseInt(args[0]);
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid PRD port");
        try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()) {
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/__admin/requests"))
                    .timeout(Duration.ofSeconds(30)).GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IOException("Journal HTTP status: " + response.statusCode());
            extract(response.body(), Path.of("build/local-stubs"));
        }
    }

    static void extract(String journal, Path base) throws Exception {
        var mapper = JsonMapper.builder().build();
        var requests = mapper.readTree(journal).path("requests");
        if (!requests.isArray()) throw new IOException("Missing requests array in journal");
        var events = new ArrayList<JsonNode>();
        requests.forEach(events::add);
        events.sort(Comparator.comparingLong(event -> event.path("request").path("loggedDate").asLong()));
        System.out.println("SOURCE\tARTIFACT\tENTRY\tBYTES\tSHA-256\tFILE");
        int count = 0;
        for (var event : events) {
            var request = event.path("request");
            String method = request.path("method").asString();
            String url = request.path("url").asString();
            var update = UPDATE.matcher(url);
            boolean create = method.equals("POST") && url.equals(ROOT);
            if (!create && !(method.equals("PUT") && update.matches())) continue;
            var body = mapper.readTree(request.path("body").asString());
            String id = create ? body.path("Id").asString() : update.group(1);
            if (!id.matches("[A-Za-z0-9_.-]{1,100}") || id.equals(".") || id.equals("..")) {
                throw new IOException("Invalid artifact identifier in journal");
            }
            if (!body.path("ArtifactContent").isString()) throw new IOException("Missing ArtifactContent: " + id);
            byte[] zip = Base64.getDecoder().decode(body.path("ArtifactContent").asString());
            Path target = base.resolve("uploads").resolve(++count + "-" + id);
            Files.createDirectories(target.getParent());
            Path zipFile = target.resolveSibling(target.getFileName() + ".zip");
            Files.write(zipFile, zip);
            describe("UPLOAD", id, zipFile, zip, target);
            Path original = base.resolve("dev-zips").resolve(id + ".zip");
            if (Files.isRegularFile(original)) describe("DEV", id, original, Files.readAllBytes(original), null);
            else System.out.println("DEV\t" + id + "\tMISSING\t-\t-\t" + original);
        }
        // The journal includes failed attempts and retries; every matching upload request is retained.
        System.out.println("Upload requests: " + count);
    }

    private static void describe(String source, String id, Path file, byte[] zip, Path extraction) throws Exception {
        row(source, id, "[ZIP]", zip, file);
        try (var input = new ZipInputStream(new ByteArrayInputStream(zip))) {
            int entries = 0;
            for (var entry = input.getNextEntry(); entry != null; entry = input.getNextEntry()) {
                entries++;
                String name = entry.getName();
                Path relative = Path.of(name);
                if (relative.isAbsolute() || name.contains("\\") || name.contains(":")
                        || relative.normalize().startsWith("..")) throw new IOException("Unsafe ZIP entry");
                byte[] content = input.readAllBytes();
                Path extracted = null;
                if (extraction != null && !entry.isDirectory() && name.endsWith(".iflw")) {
                    extracted = extraction.resolve(relative).normalize();
                    if (!extracted.startsWith(extraction.normalize())) throw new IOException("Unsafe ZIP entry");
                    Files.createDirectories(extracted.getParent());
                    Files.write(extracted, content);
                }
                row(source, id, name, content, extracted);
            }
            if (entries == 0) throw new IOException("ZIP has no entries: " + id);
        }
    }

    private static void row(String source, String id, String entry, byte[] content, Path file) throws Exception {
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        System.out.printf("%s\t%s\t%s\t%d\t%s\t%s%n", source, id,
                entry.replace('\t', '_').replace('\n', '_').replace('\r', '_'), content.length, hash,
                file == null ? "-" : file);
    }
}
