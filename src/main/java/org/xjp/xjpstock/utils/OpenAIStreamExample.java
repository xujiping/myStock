package org.xjp.xjpstock.utils;

import okhttp3.*;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * @author xujiping
 */
public class OpenAIStreamExample {
    private static final String API_KEY = "sk-d529a1aa3a1846e8ab7f8517a284c7d1";
    private static final String API_URL = "https://api.deepseek.com/chat/completions";

    public static void main(String[] args) {
        OkHttpClient client = new OkHttpClient();

        // 构建请求体
        MediaType JSON = MediaType.get("application/json; charset=utf-8");
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", "deepseek-chat");
        requestBody.put("messages", new Object[]{
                new HashMap<String, String>() {{
                    put("role", "user");
                    put("content", "介绍一下北京故宫");
                }}
        });
        requestBody.put("stream", true);

        String json = new com.google.gson.Gson().toJson(requestBody);
        RequestBody body = RequestBody.create(JSON, json);

        // 构建请求
        Request request = new Request.Builder()
                .url(API_URL)
                .addHeader("Authorization", "Bearer " + API_KEY)
                .post(body)
                .build();

        // 发送请求并处理流式响应
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                e.printStackTrace();
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                try (ResponseBody responseBody = response.body()) {
                    if (!response.isSuccessful()) throw new IOException("Unexpected code " + response);
                    if (responseBody != null) {
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(responseBody.byteStream()));
                        String line;
                        while ((line = reader.readLine()) != null) {
                            if (line.startsWith("data: ")) {
                                String data = line.substring(6);
                                if (!data.equals("[DONE]")) {
                                    // 解析 JSON 数据
                                    com.google.gson.JsonObject jsonObject = new com.google.gson.JsonParser().parse(data).getAsJsonObject();
                                    com.google.gson.JsonArray choices = jsonObject.getAsJsonArray("choices");
                                    if (choices.size() > 0) {
                                        com.google.gson.JsonObject choice = choices.get(0).getAsJsonObject();
                                        com.google.gson.JsonObject delta = choice.getAsJsonObject("delta");
                                        if (delta.has("content")) {
                                            String content = delta.get("content").getAsString();
                                            System.out.print(content);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    }
}
