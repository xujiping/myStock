package org.xjp.xjpstock.business.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.springframework.stereotype.Repository;
import org.xjp.xjpstock.business.entity.Memory;

/**
 * (Memory)表数据库访问层
 *
 * @author xujiping
 * @since 2025-02-20 15:12:40
 */
@Mapper
public interface MemoryMapper extends BaseMapper<Memory> {

}

