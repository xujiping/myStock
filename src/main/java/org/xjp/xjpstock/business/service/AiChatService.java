package org.xjp.xjpstock.business.service;

import org.xjp.xjpstock.business.dto.AiExplainDto;
import org.xjp.xjpstock.business.params.AiChatParam;
import reactor.core.publisher.FluxSink;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-20 11:21
 * @Description: TODO
 */
public interface AiChatService {
    /**
     * 聊天-非流式回答
     * @param aiChatParam
     * @return
     */
    String chatWithNonStream(AiChatParam aiChatParam);

    /**
     * 聊天-流式回答
     * @param aiChatParam
     * @param sink
     */
    void chatWithStream(AiChatParam aiChatParam, FluxSink<String> sink);

    /**
     * 解释消息并返回
     * @param message
     * @return
     */
    AiExplainDto explain(String message);
}
