package com.company.sap.cpitransport.config;

import jakarta.servlet.ServletException;
import java.io.IOException;
import java.util.regex.Pattern;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ValveBase;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class JobPathErrorConfiguration {
    // Tomcat rejects encoded slashes before MVC. Translate only its rejected job-ID responses.
    @Bean
    WebServerFactoryCustomizer<TomcatServletWebServerFactory> rejectedJobPath() {
        return factory -> {
            var path = Pattern.compile(Pattern.quote(factory.getContextPath() + "/transport/jobs/") + "[^/]*%2[fF][^/]*");
            factory.addEngineValves(new ValveBase(true) {
                @Override
                public void invoke(Request request, Response response) throws IOException, ServletException {
                    if (response.getStatus() == 400 && response.isErrorReportRequired()) {
                        String uri = request.getRequestURI();
                        boolean cancel = "POST".equals(request.getMethod()) && uri.endsWith("/cancel");
                        String jobPath = cancel ? uri.substring(0, uri.length() - "/cancel".length()) : uri;
                        if ((cancel || "GET".equals(request.getMethod())) && path.matcher(jobPath).matches()) {
                            response.setErrorReported();
                            response.setSuspended(false);
                            response.setStatus(404);
                            response.setContentType("application/json");
                            response.getWriter().write("{\"error\":\"JOB_NOT_FOUND\",\"message\":\"Job not found\"}");
                            return;
                        }
                    }
                    getNext().invoke(request, response);
                }
            });
        };
    }
}
