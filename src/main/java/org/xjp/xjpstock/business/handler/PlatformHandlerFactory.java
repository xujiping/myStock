package org.xjp.xjpstock.business.handler;

import org.xjp.xjpstock.common.enums.AiPlatformEnum;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 平台工厂
 *
 * @author xujiping
 */
public class PlatformHandlerFactory {

    private static final Map<String, Map<String, AbstractPlatformHandler<?>>> HANDLERS =
            new ConcurrentHashMap<>();

    /**
     * 注册处理器
     **/
    public static void registerHandler(AiPlatformEnum aiPlatformEnum, AbstractPlatformHandler<?> handler) {
        HANDLERS.computeIfAbsent(aiPlatformEnum.getCode(), k -> new ConcurrentHashMap<>())
                .put(aiPlatformEnum.getCode(), handler);
    }

    /**
     * 获取处理器
     **/
    public static AbstractPlatformHandler<?> getHandler(AiPlatformEnum aiPlatformEnum) {
        return Optional.ofNullable(HANDLERS.get(aiPlatformEnum.getCode()))
                .map(sceneMap -> sceneMap.get(aiPlatformEnum.getCode()))
                .orElseThrow(() -> new IllegalArgumentException("未找到对应的处理器"));
    }
}
