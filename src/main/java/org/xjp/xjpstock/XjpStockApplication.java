package org.xjp.xjpstock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;

/**
 * @author xujiping
 */
@SpringBootApplication
@ComponentScan(basePackages = {"org.xjp.xjpstock.business"})
public class XjpStockApplication {

    public static void main(String[] args) {
        SpringApplication.run(XjpStockApplication.class, args);
    }

}
