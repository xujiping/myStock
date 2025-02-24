package org.xjp.xjpstock.utils;

import cn.hutool.core.util.ObjectUtil;
import lombok.extern.slf4j.Slf4j;
import okhttp3.*;
import org.xjp.xjpstock.business.handler.StreamResponseCallback;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * @author xujiping
 */
@Slf4j
public class LargeModelAPICaller {
    // 创建 OkHttpClient 并设置超时时间
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            // 连接超时时间
            .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            // 读取超时时间
            .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
            // 写入超时时间
            .writeTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .build();
    private static final com.google.gson.Gson GSON = new com.google.gson.Gson();

    /**
     * 非流式调用大模型 API
     *
     * @param apiUrl API 的 URL
     * @param apiKey API 密钥
     * @param model  模型名称
     * @param prompt 用户输入的提示信息
     * @return 模型返回的完整响应内容
     * @throws IOException 网络请求异常
     */
    public static String nonStreamCall(String apiUrl, String apiKey, String model, List<Map<String, String>> messages) {
        MediaType JSON = MediaType.get("application/json; charset=utf-8");
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", model);
        requestBody.put("messages", messages);
        requestBody.put("stream", false);

        String json = GSON.toJson(requestBody);
        RequestBody body = RequestBody.create(JSON, json);

        Request request = new Request.Builder()
                .url(apiUrl)
                .addHeader("Authorization", "Bearer " + apiKey)
                .post(body)
                .build();

        try (Response response = CLIENT.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected code " + response);
            }
            ResponseBody responseBody = response.body();
            if (responseBody != null) {
                try {
                    // 解析 JSON 数据
                    com.google.gson.JsonObject jsonObject = new com.google.gson.JsonParser().parse(responseBody.string()).getAsJsonObject();
                    com.google.gson.JsonArray choices = jsonObject.getAsJsonArray("choices");
                    if (!choices.isEmpty()) {
                        com.google.gson.JsonObject choice = choices.get(0).getAsJsonObject();
                        com.google.gson.JsonObject message = choice.getAsJsonObject("message");
                        if (ObjectUtil.isNotEmpty(message) && message.has("content")) {
                            return message.get("content").getAsString();
                        }
                    }
                    return responseBody.string();
                } catch (Exception e) {
                    log.error(e.getMessage(), e);
                    return "网络错误";
                }
            }
        }catch (Exception e) {
            log.error(e.getMessage(), e);
        }
        return null;
    }

    /**
     * 流式调用大模型 API
     *
     * @param apiUrl   API 的 URL
     * @param apiKey   API 密钥
     * @param model    模型名称
     * @param prompt   用户输入的提示信息
     * @param callback 回调接口实例
     */
    public static void streamCall(String apiUrl, String apiKey, String model, List<Map<String, String>> messages, StreamResponseCallback callback) {
        MediaType JSON = MediaType.get("application/json; charset=utf-8");
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", model);
        requestBody.put("messages", messages);
        requestBody.put("stream", true);

        String json = GSON.toJson(requestBody);
        RequestBody body = RequestBody.create(JSON, json);

        Request request = new Request.Builder()
                .url(apiUrl)
                .addHeader("Authorization", "Bearer " + apiKey)
                .post(body)
                .build();

        CLIENT.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError(e);
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (ResponseBody responseBody = response.body()) {
                    if (!response.isSuccessful()) {
                        throw new IOException("Unexpected code " + response);
                    }
                    if (responseBody != null) {
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(responseBody.byteStream()));
                        String line;
                        while ((line = reader.readLine()) != null) {
                            if (line.startsWith("data: ")) {
                                String data = line.substring(6);
                                if (!data.equals("[DONE]")) {
                                    com.google.gson.JsonObject jsonObject = new com.google.gson.JsonParser().parse(data).getAsJsonObject();
                                    com.google.gson.JsonArray choices = jsonObject.getAsJsonArray("choices");
                                    if (choices.size() > 0) {
                                        com.google.gson.JsonObject choice = choices.get(0).getAsJsonObject();
                                        com.google.gson.JsonObject delta = choice.getAsJsonObject("delta");
                                        if (delta.has("content")) {
                                            String content = delta.get("content").getAsString();
                                            callback.onContentReceived(content);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    callback.onComplete();
                } catch (Exception e) {
                    callback.onError(e);
                }
            }
        });
    }


    public static void main(String[] args) {
        String apiUrl = "https://api.deepseek.com/chat/completions";
        String apiKey = "sk-d529a1aa3a1846e8ab7f8517a284c7d1";
        String model = "deepseek-chat";
        String prompt = "你可以做什么";

        //            // 非流式调用
//            String response = nonStreamCall(apiUrl, apiKey, model, prompt);
//            System.out.println("非流式响应: " + response);

        // 流式调用
        System.out.println("流式响应:");
        ArrayList<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of("role", "assistant", "content", "你是我的个人助理"));
        messages.add(Map.of("role", "user", "content", "你好"));
        streamCall(apiUrl, apiKey, model, messages, new StreamResponseCallback() {
            @Override
            public void onContentReceived(String content) {
                System.out.print(content);
            }

            @Override
            public void onError(Exception e) {
                e.printStackTrace();
            }

            @Override
            public void onComplete() {
                System.out.println("\n流式响应结束");
            }
        });
    }
}

