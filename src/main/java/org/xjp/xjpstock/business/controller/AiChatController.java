package org.xjp.xjpstock.business.controller;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.xjp.xjpstock.business.params.AiChatParam;
import org.xjp.xjpstock.business.service.AiChatService;
import org.xjp.xjpstock.common.entity.Response;
import reactor.core.publisher.Flux;

import javax.annotation.Resource;

/**
 * @author xujiping
 */
@RestController
@RequestMapping("/api/ai")
public class AiChatController {

    @Resource
    private AiChatService aiChatService;

    @PostMapping(value = "/chatWithStream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
    public Flux<String> chatWithStream(@RequestBody AiChatParam aiChatParam) {
        return Flux.create(sink -> {
            try {
                aiChatService.chatWithStream(aiChatParam, sink);
            } catch (Exception e) {
                sink.error(e);
            }
        });
    }

    @PostMapping(value = "/chatWithNonStream")
    public Response<String> chatWithNonStream(@RequestBody AiChatParam aiChatParam) {
        return Response.succeed(aiChatService.chatWithNonStream(aiChatParam));
    }

}