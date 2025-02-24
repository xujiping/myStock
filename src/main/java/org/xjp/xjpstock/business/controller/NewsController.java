package org.xjp.xjpstock.business.controller;

import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.xjp.xjpstock.business.service.INewsService;
import org.xjp.xjpstock.common.entity.Response;

import java.util.List;

/**
 * @Author: xujiping
 * @CreateTime: 2024-11-27 16:19
 * @Description: TODO
 */
@RestController("/news")
public class NewsController {

    @Resource private INewsService newsService;

    @GetMapping("/list")
    public Response<List<String>> list(){
        return Response.succeed(newsService.getNews());
    }
}
