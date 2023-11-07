## 引子

这两天在研究 telegram bot，意外的接触到了 Docker，发现特别好用。Python 菜鸟的我，之前在服务器上想实现 Python 脚本驻留特别费劲，宝塔自带的 Python 定时执行脚本可靠性不高总出错（也可能是我菜），而 Docker，却神奇的能够解决这个问题。  
Docker 是一个强大的工具，它可以用来封装、分发和运行应用程序。它允许您将应用程序及其环境和依赖项打包成一个容器，这个容器可以在任何支持 Docker 的系统上运行。
对于 Python 脚本来说，Docker 可以确保您的脚本在一个与您的开发环境几乎一模一样的环境中运行，无论它被部署到什么样的服务器或云服务上。  
那么就把这次 tg bot 利用 Docker 进行部署的简要过程记录下来，以之备忘。

## 准备

- 一个写好了的Python脚本
- 一台服务器
- 在服务器上安装好Docker

## 部署过程

### 第一步：创建一个Dockerfile

要将 Python 程序封装成 Docker 容器，你需要创建一个 Dockerfile，并且使用 Docker CLI 命令来构建和运行 Docker 镜像。在你的项目根目录下，创建一个名为 Dockerfile 的文件，没有文件扩展名。该文件包含了 Docker 镜像的构建指令。将以下信息复制粘贴到文件里：  
```
# 使用官方Python运行时作为父镜像
FROM python:3.7-slim

# 设置工作目录为/app
WORKDIR /app

# 将当前目录内容复制到位于/app中的容器中
COPY . /app

# 安装requirements.txt中指定的任何所需包
RUN pip install --no-cache-dir -r requirements.txt

# 让端口5000可用于外界访问
EXPOSE 5000

# 定义环境变量
ENV OPENAI_API_KEY=''
ENV TELEGRAM_TOKEN=''

# 在容器启动时运行main.py
CMD ["python", "./main.py"]

```
需要注意的是环境变量有可能将我们的隐私数据暴露在公共空间里，在 Dockerfile 中，您可以声明一个环境变量，但不要为它赋值，而把敏感数据存储在环境变量文件里，稍后会提到。  

### 第二步：创建requirements.txt
确保项目文件夹里包含一个 requirements.txt 文件，它应列出了所有必需的 Python 库。例如：
```
telebot
requests
```

### 第三步：创建env.list环境变量
使用一个 env.list 文件来定义环境变量，这个文件也应该放在 Docker 构建上下文中，通常是与 Dockerfile 处在同一个目录。在运行容器时，可以使用 ```--env-file``` 选项指定环境变量文件。  
这个 env.list 文件应该包含环境变量的键值对，每行一个，例如：
```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```
这里需要有几点特别注意：  
- 请确保不要将 env.list 文件提交到公共代码仓库中，因为它包含敏感信息。如果需要在公共空间托管代码，你应该在 .gitignore 文件中添加 env.list 来避免将其推送到远程仓库。
- 注意键值对的等号前后不要留有空格，不然会报错。
- 如果您选择使用 env.list 文件或者 Docker 的环境变量功能来传递 API 密钥，您应该确保不在 main.py 文件中硬编码这些密钥。相反，您应该修改 main.py 来从环境变量中读取这些密钥。像下面这样：
```
import os
import telebot

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')

bot = telebot.TeleBot(TELEGRAM_TOKEN)

```

至此你的项目文件夹里应该包含四个文件：Python 脚本，Dockerfile，requirements.txt和 .dockerignore 文件、环境变量文件。

### 第四步：创建 .dockerignore 文件

.dockerignore 文件的作用是告诉 Docker 在构建镜像时应忽略项目中的哪些文件和目录。这样做可以避免不必要的文件被复制到镜像中，同时也有助于防止将敏感信息包含到镜像里。如果您的项目中还没有 .dockerignore 文件，您可以按照以下步骤创建一个：
在您的项目根目录（即 Dockerfile 所在的目录）打开终端或命令行。使用文本编辑器创建一个名为 .dockerignore 的新文件。
在 .dockerignore 文件中，您可以添加不希望包含到 Docker 镜像中的文件或目录名称。每个条目占一行。例如，您的 .dockerignore 文件内容可以是这样的：
```
.env
env.list
.dockerignore
.git
.gitignore
Dockerfile
*.md

```
上述内容告诉 Docker 忽略掉列出的文件和目录，这包括环境变量文件（.env 和 env.list），Git 目录（.git），以及所有 markdown 文件（*.md）。
创建好 .dockerignore 文件后，当您运行 docker build 命令构建镜像时，这些文件和目录就不会被包含进去。这有助于保护您的敏感数据不被无意中加入到 Docker 镜像中，并且能让镜像保持轻量级。

### 第五步：构建Docker镜像

构建镜像前需要确保没有正在运行的名为 tg-interpreter-bot 的容器，如果有，停止并删除它

```
docker rm -f tg-interpreter-bot
```

在包含 Dockerfile 的目录下重新构建 Docker 镜像，如果当前位置不对，需要cd到项目目录。
```
docker build -t tg-interpreter-bot .
```

### 第六步：运行 Docker 容器
```
docker run -d --name tg-interpreter-bot --env-file env.list --restart=always tg-interpreter-bot
```

这里的 -d 可以让容器在后台运行，--restart=always 可以让容器在进程崩溃或系统重启重新运行。如果想要用 Docker 停止运行，使用我们在搭建 VPN 时使用到的 stop 命令即可：  

```
docker stop tg-interpreter-bot
```

重新启动，可以把 stop 改换成 start。

## 结语

如此我们的 Docker 就能顺利地运行 Python 脚本了。丝滑流畅，24小时不间断，居家必备。
