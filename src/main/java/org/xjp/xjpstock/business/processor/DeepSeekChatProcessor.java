package org.xjp.xjpstock.business.processor;

import lombok.extern.slf4j.Slf4j;
import org.xjp.xjpstock.business.dto.AiChatDto;


/**
 * @author xujiping
 */
@Slf4j
public class DeepSeekChatProcessor implements BusinessProcessor<AiChatDto> {

    @Override
    public void preProcess(AiChatDto sourceData) {
        // 前置处理
        BusinessProcessor.super.preProcess(sourceData);
    }

    @Override
    public void postProcess(AiChatDto sourceData, Object result) {
        // todo 返回数据处理
    }
}
