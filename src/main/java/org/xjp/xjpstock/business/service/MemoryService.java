package org.xjp.xjpstock.business.service;

import com.baomidou.mybatisplus.extension.service.IService;
import org.xjp.xjpstock.business.entity.Memory;

/**
 * (Memory)表服务接口
 *
 * @author xujiping
 * @since 2025-02-20 15:12:40
 */
public interface MemoryService extends IService<Memory> {

    /**
     * 处理AI解析的数据
     * @param response
     */
    void handler(String response);
}

