package org.xjp.xjpstock.business.handler;

import org.xjp.xjpstock.business.dto.AiChatDto;
import org.xjp.xjpstock.business.processor.DeepSeekChatProcessor;
import org.xjp.xjpstock.business.strategy.DeepSeekChatRemoteCallStrategy;

/**
 * DeepSeek聊天处理器
 *
 * @ClassName: KtmPersonLossHandler
 * @Author: guopei
 * @Date: 2024/12/9 10:06
 */
public class DeepSeekChatHandler extends AbstractPlatformHandler<AiChatDto> {

    public DeepSeekChatHandler() {
        super(new DeepSeekChatProcessor(), new DeepSeekChatRemoteCallStrategy());
    }

    @Override
    public <R> R processPush(Object originalData) {
        return super.processPush(originalData);
    }
}
