package org.xjp.xjpstock.business.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

/**
 * (Memory)表实体类
 *
 * @author xujiping
 * @since 2025-02-20 15:12:40
 */
@EqualsAndHashCode(callSuper = true)
@Data
@TableName("ai_memory")
public class Memory extends Model<Memory> {

    @Serial
    private static final long serialVersionUID = 2892152845374233310L;

    private Long id;

    private String category;

    private String title;

    private Date time;

    private String originalWords;

    private String explains;


    /**
     * 获取主键值
     *
     * @return 主键值
     */
    @Override
    public Serializable pkVal() {
        return this.id;
    }
}

