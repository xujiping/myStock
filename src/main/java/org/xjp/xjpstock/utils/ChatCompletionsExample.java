package org.xjp.xjpstock.utils;

import com.volcengine.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.volcengine.ark.runtime.model.completion.chat.ChatMessage;
import com.volcengine.ark.runtime.model.completion.chat.ChatMessageRole;
import com.volcengine.ark.runtime.service.ArkService;

import lombok.extern.slf4j.Slf4j;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Slf4j
public class ChatCompletionsExample {
    private static String apiKey = System.getenv("ARK_API_KEY");
    private static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    private static ArkService service = ArkService.builder()
            .dispatcher(new Dispatcher())
            .connectionPool(connectionPool)
            .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
            .apiKey(apiKey)
            .build();

    /**
     * API地址：https://www.volcengine.com/docs/82379/1108216
     * 
     * @param args
     */
    public static void main(String[] args) {
        String roleUserString = "";

        getChatCompletionResponse(roleUserString, true);

    }

    /**
     * 获取聊天补全的回答
     * 
     * @param messages    聊天消息列表
     * @param isStreaming 是否使用流式输出
     */
    public static void getChatCompletionResponse(String msg, boolean isStreaming) {
        try {
            System.out.println("\n----- 开始 回答 -----");
            String roleSystemString = "你是豆包，是由字节跳动开发的 AI 人工智能助手";
            final List<ChatMessage> messages = new ArrayList<>();
            final ChatMessage systemMessage = ChatMessage.builder().role(ChatMessageRole.SYSTEM).content(roleSystemString).build();
            final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER).content(msg).build();
            messages.add(systemMessage);
            messages.add(userMessage);
            ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
                    .model("ep-20250110180904-fkr28")
                    .messages(messages)
                    .build();
            if (isStreaming) {
                service.streamChatCompletion(chatCompletionRequest)
                        .doOnError(Throwable::printStackTrace)
                        .blockingForEach(choice -> {
                            if (choice.getChoices().size() > 0) {
                                String content = (String) choice.getChoices().get(0).getMessage().getContent();
                                for (char c : content.toCharArray()) {
                                    System.out.print(c);
//                                    try {
//                                        Thread.sleep(50); // 控制每个字的输出速度
//                                    } catch (InterruptedException e) {
//                                        e.printStackTrace();
//                                    }
                                }
                            }
                        });
            } else {
                String response = (String) service.createChatCompletion(chatCompletionRequest).getChoices().get(0)
                        .getMessage().getContent();
                System.out.println(response);
            }
            System.out.println("\n----- 回答 结束 -----");
        } catch (Exception e) {
            log.error("AI 回答异常", e);
        } finally {
            // shutdown service after all requests is finished
            service.shutdownExecutor();
        }
    }
}