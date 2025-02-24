package org.xjp.xjpstock.business.service.impl;

import cn.hutool.core.date.DateUtil;
import cn.hutool.core.util.ObjectUtil;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.xjp.xjpstock.business.mapper.MemoryMapper;
import org.xjp.xjpstock.business.entity.Memory;
import org.xjp.xjpstock.business.service.MemoryService;
import org.springframework.stereotype.Service;

/**
 * (Memory)表服务实现类
 *
 * @author xujiping
 * @since 2025-02-20 15:12:40
 */
@Slf4j
@Service("memoryService")
public class MemoryServiceImpl extends ServiceImpl<MemoryMapper, Memory> implements MemoryService {

    @Override
    public void handler(String response) {
        Memory memory = new Memory();
        memory.setExplains(response);
        try {
            JSONObject jsonObject = JSONObject.parseObject(response);
            memory.setCategory(jsonObject.getString("category"));
            JSONObject detail = jsonObject.getJSONObject("detail");
            if (ObjectUtil.isNotEmpty(detail)) {
                memory.setTitle(detail.getString("title"));
                memory.setTime(DateUtil.parse(detail.getString("date")));
                memory.setOriginalWords(detail.getString("original"));
            }
        } catch (Exception e) {
            log.error("数据解析失败");
        }
        if (!save(memory)) {
            log.error("数据保存失败");
        }
    }
}

