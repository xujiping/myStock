package org.xjp.xjpstock.business.service.impl;

import cn.hutool.http.HttpUtil;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import org.springframework.stereotype.Service;
import org.xjp.xjpstock.business.service.INewsService;

import java.util.ArrayList;
import java.util.List;

/**
 * @Author: xujiping
 * @CreateTime: 2024-11-27 16:22
 * @Description: 数据源：https://api.52vmy.cn/doc/wl/60s/new.html
 */
@Service
public class VmyNewsService implements INewsService {
    @Override
    public List<String> getNews() {
        String response = HttpUtil.get("https://api.52vmy.cn/api/wl/60s/new");
        JSONObject result = JSONObject.parseObject(response);
        if (result.getInteger("code") == 200) {
            JSONArray data = result.getJSONArray("data");
            System.out.println();
            return result.getJSONArray("data").toJavaList(String.class);
        }
        return new ArrayList<>();
    }
}
