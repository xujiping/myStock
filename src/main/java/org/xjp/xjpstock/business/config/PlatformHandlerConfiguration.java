package org.xjp.xjpstock.business.config;

import org.springframework.context.annotation.Configuration;
import org.xjp.xjpstock.business.handler.DeepSeekChatHandler;
import org.xjp.xjpstock.business.handler.PlatformHandlerFactory;
import org.xjp.xjpstock.common.enums.AiPlatformEnum;

import javax.annotation.PostConstruct;

/**
 *
 * @ClassName: PlatformHandlerConfiguration
 * @Author: guopei
 * @Date: 2024/12/9 11:39
 */
@Configuration
public class PlatformHandlerConfiguration {
    /** 
     * 初始化风控平台处理器
     **/
    @PostConstruct
    public void initPlatformHandlers() {
        // 注册推送人伤定损到凯泰铭的处理器
        PlatformHandlerFactory.registerHandler(
                AiPlatformEnum.DEEPSEEK_CHAT,
                new DeepSeekChatHandler()
        );
    }
}
