# 

## 前情

微博炸号以后，建站对我而言就变得十分刚需。  
非常简约的网站文档生成器，只需要较少的配置就可以实现个人博客的搭建。

## docsify + github 方案的优点

docsify是一个神奇的文档网站生成工具，页面内容使用markdown进行书写，主要有如下优点：

- 简单、轻量
- 不会编译生成html文件
- 有多种主题可以选择
- 丰富的插件
- 支持服务端渲染
- 支持文档嵌入

## 动手

### 1.准备

你要有：
- 一台能连上网的电脑
- GitHub 账号
- Node.js


### 2.搭建

#### 2.1安装docsify

一旦安装好node.js，接下来只需要执行下面命令就可以很方便地安装docsify：

      ```npm i docsify-cli -g```


#### 2.2初始化

收到安装成功的提示接下来你需要使用以下命令在本地初始化docsify：

      ```docsify init <docs_dir>```

其中<docs_dir>是你的文档目录，这将会在你的当前目录下创建一个名为<docs_dir>的文件夹，并将其作为docsify站点的根目录。此外，这个命令还将在该目录中生成一些必要的文件，包括index.html、README.md和_config.yml等。

如果你希望站点根目录下的文件不仅限于文档，则可以使用以下命令初始化：

     ```docsify init <docs_dir> --no-ss```
      
这将创建一个简单的HTML文件，其中包含一些默认的样式和配置，但不会生成任何文档页面。

#### 2.3启动

完成初始化后，你可以使用以下命令在本地启动docsify站点：

     ```docsify serve <docs_dir>```

其中<docs_dir>是你的文档目录，这将会在本地启动一个HTTP服务器，并将你的文档站点发布到localhost:3000。现在你可以在浏览器中打开http://localhost:3000 bingo！搭建完成！

### 3.美化

#### 3.1侧边栏
通过在window.$docsify中设置loadSidebar为true，会使用默认的_sidebar.md

<!-- index.html -->

<script>
  window.$docsify = {
    ...
    loadSidebar: true,
    subMaxLevel: 2,
    ...
  }
</script>

#### 3.2封面
#### 3.3README.MD

### 4.部署到gayhub
#### 4.1创建仓库
#### 4.2用Github Pages建立站点
#### 4.3绑定域名
