package org.xjp.xjpstock.common.enums;

import lombok.Getter;

/**
 * AI平台枚举
 *
 * @Author: xujiping
 * @CreateTime: 2025-02-19 15:08
 */
@Getter
public enum AiPlatformEnum {
    DEEPSEEK_CHAT("deepseek-chat", "DeepSeek V3"),
    ;

    private String code;
    private String name;

    AiPlatformEnum(String code, String name) {
        this.code = code;
        this.name = name;
    }

    public static AiPlatformEnum getEnumByCode(String code) {
        for (AiPlatformEnum e : AiPlatformEnum.values()) {
            if (e.getCode().equals(code)) {
                return e;
            }
        }
        return AiPlatformEnum.DEEPSEEK_CHAT;
    }

}
