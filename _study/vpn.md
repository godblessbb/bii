# 

# 如何在一分钟之内搭建一个VPN

## 前情

不知不觉，一直在用的VPN在昨天过期了。由于笔者的毛躁和大意，这种忘记续费的情况基本上每年都能遇上百八十回。每次状况发生都是伤害不大，麻烦不小，由于众所周知的原因，这类VPN的充值网站经常性地被迫流亡，一旦续费不及时很可能就会遇到要给已经过期的VPN续费你需要先有一个VPN的哲学之问。求人借账号又显得太low，今次终于找到了一个可以一劳永逸解决问题的办法。只要有一台境外服务器，只需要较少的配置很少的时间就可以实现个人IPsec VPN的应急搭建。这个方案的优点是搭建快速简单，并且可靠，只要我们还可以用信用卡购买到境外的服务器（阿里云腾讯云等也提供境外服务器），你就永远有机会给你的梯子续命。

## 准备工作

动手前你需要准备以下工具：

- 一台境外服务器
- 在服务器上安装Docker


## OK，动手

### 1.规划VPN配置信息

如果没有安装Docker请在这部开始前自行安装，Docker是一个流行的容器化平台，可以更方便地搭建、管理和部署应用程序。这里假定你已经安装好了Docker。

#### 1.1创建一个配置文件

在服务器的任意一个位置，创建一个配置文件。如，你可以在根目录下创建一个文件夹为/data/jump/vpn/，在此文件夹里创建一个.env文件。配置文件的完整路径为/data/jump/vpn/.env

#### 1.2填写配置信息

打开.env文件，按照下面的格式填写必要的信息，填写示例如下：

```
VPN_IPSEC_PSK=password1!
# 配置用于登陆VPN的账号和密码
VPN_USER=vpn
VPN_PASSWORD=vpn1234
# 如下应该填写本机的外网IP（服务器ip）
VPN_PUBLIC_IP=36.111.179.*
# 配置额外的用户名和密码
VPN_ADDL_USERS=vpn1 vpn2
VPN_ADDL_PASSWORDS=vpn11234 pass21234
#DNS配置
VPN_DNS_SRV1=8.8.8.5
VPN_DNS_SRV2=114.114.114.114
```

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

