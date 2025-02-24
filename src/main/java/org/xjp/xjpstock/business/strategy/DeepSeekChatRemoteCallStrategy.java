package org.xjp.xjpstock.business.strategy;

import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.xjp.xjpstock.business.dto.AiChatDto;
import org.xjp.xjpstock.common.enums.AiPlatformEnum;
import org.xjp.xjpstock.utils.LargeModelAPICaller;

/**
 * @ClassName: KtmPersonLossRemoteCallStrategy
 * @Author: guopei
 * @Date: 2024/12/9 9:46
 */
@Data
@Slf4j
public class DeepSeekChatRemoteCallStrategy implements RemoteCallStrategy<AiChatDto> {

    private static final String API_URL = "https://api.deepseek.com/chat/completions";
    private static final String API_KEY = "sk-d529a1aa3a1846e8ab7f8517a284c7d1";
    private static final AiPlatformEnum MODEL = AiPlatformEnum.DEEPSEEK_CHAT;

    @Override
    public Object call(AiChatDto dto) {
        if (!dto.isSteam()) {
            return LargeModelAPICaller.nonStreamCall(API_URL, API_KEY, AiPlatformEnum.DEEPSEEK_CHAT.getCode(), dto.getMessages());
        }
        LargeModelAPICaller.streamCall(API_URL, API_KEY, MODEL.getCode(), dto.getMessages(), dto.getCallback());
        return null;
    }

}
