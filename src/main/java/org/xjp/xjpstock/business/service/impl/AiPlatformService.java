package org.xjp.xjpstock.business.service.impl;

import org.springframework.stereotype.Service;
import org.xjp.xjpstock.business.handler.AbstractPlatformHandler;
import org.xjp.xjpstock.business.handler.PlatformHandlerFactory;
import org.xjp.xjpstock.common.enums.AiPlatformEnum;

/**
 * AI平台服务
 * @author xujiping
 */
@Service
public class AiPlatformService {
    
    /** 
     * 推送数据到风控平台
     **/
    public <R> R pushToPlatform(AiPlatformEnum aiPlatformEnum, Object originalData) {
        // 获取对应的处理器
        AbstractPlatformHandler<?> handler =
                PlatformHandlerFactory.getHandler(aiPlatformEnum);

        // 执行推送
        return (R) handler.processPush(originalData);
    }
}
