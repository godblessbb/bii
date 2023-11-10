## 背景

我就是那个手里拿着锤子，满世界找钉子的人。  

学会了 Docker，现在又有 ChatGPT 加持，巴不得日常所有可以自动化的工作全都丢给服务器让 Docker 自己去搞定。今天解决的自动化工作内容，是申请进京证。在北京有过开车经验的外地朋友都知道，京牌摇不到，想开车除了租牌就得申请进京证。而进京证必须随用随申请，事多起来忘记申请是家常便饭，而一旦无证上路，被拍到就是扣分罚款，让本不富裕的家庭雪上加霜。  

那么该如何让申请进京证这件事变成触手可及，一键立等可取呢，这篇文章将作探讨。


## 准备

整件事的大逻辑就是，让服务器24小时不间断地运行你的Python脚本，用 Telegram Bot 作为交互界面，在 tg 上进行需要的操作将指令发送给服务器，服务器通过远程模拟用户登录完成在北京交警 app 上的填表操作。所以你需要：  

- 在北京交警上的注册账号
- iPhone 抓包工具：stream
- 一台服务器
- TG账号

FBI Warning：虽然国家机构官网反爬能力约等于没有，不建议将本项目用于学习以外的其他用途，一来浪费公共资源，二来手铐其实是最强的反爬能力。任何商用或是超出个人实际用途的爬取数据行为，三思。


## 抓包

由于我们的脚本将会在服务器上模拟你自己登陆北京交警 app 并填表的全过程，所以我们首先要获取到这两个关键信息即目标站的 URL 以及我们作为用户本身的登录令牌。这里介绍的抓包工具是[iOS 平台抓包工具 Stream 教程](https://cloud.tencent.com/developer/article/1858102)，点击链接可以看到从安装到抓包的详细教程，不做赘述。  

当我们打开北京交警应用以后，同一时间调起 Stream，你会看到若干个同北京交警相关的进程。从中很容易就能找到一个包含gov的地址，记住这个url地址，然后访问凭证，获取头信息里的 Authorization 字段，这是你的登录令牌。为了防范恶意使用，这里不贴获取的具体过程。


## 编写 Python 脚本

接下来，上脚本：  

、、、
import sys
import json
import requests
from datetime import datetime,timedelta
class AutoRenewTrafficPermit(object):
    def __init__(self):
        # 初始地址，防止恶意访问，请求地址不提供，需要的自行抓包
        url = 
        # 查询状态接口
        self.state_url = f"https://{url}/pro/applyRecordController/stateList"
        # 办理续签接口
        self.inster_apply_record_url = f"https://{url}/pro/applyRecordController/insertApplyRecord"
        # 访问凭证，通过抓包在请求头信息 Authorization 字段
        self.auth = 
        # 续签接口数据只展示部分说明，其他的需要自行抓包研究
        # 车主姓名
        user_name = 
        # 车主身份证号
        id_num = ""
        # 车牌号
        plate_num = 
        # 进京地址
        address = 
        # 以申请明天开始为例
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        self.payload = {
            "sqdzgdjd" : "",
            "txrxx" : [
            ],
            "hpzl" : "",
            "applyIdOld" : "",
            "sqdzgdwd" : "",
            "jjmdmc" : "其它",
            "jsrxm" : user_name,
            "jszh" : id_num,
            "jjdq" : "",
            "jjmd" : "",
            "sqdzbdjd" : "",
            "sqdzbdwd" : "",
            "jjzzl" : "",
            "jjlk" : "",
            "hphm" : plate_num,
            "vId" : "",
            "jjrq" : tomorrow,
            "jjlkmc" : "其他道路",
            "xxdz" : address
        }

    def request(self, url, payload):
        headers = {
            "Authorization": self.auth,
            "Content-Type": "application/json"
        }
        res = requests.request("POST", url, headers=headers, data=payload)
        return res.json()

    def getRemainingTime(self):
        state_result_json = self.request(self.state_url,payload = {})
        status_code = state_result_json["code"]
        msg = state_result_json["msg"]
        if status_code != 200:
            print(f"状态码不等于200，接口异常，状态码：{status_code}，错误信息：{msg}")
            sys.exit()
        # 已经申请续签后，会有ecbzxx字段的数据显示审核通过(待生效)、以及最新的截止日期
        if state_result_json["data"]["bzclxx"][0]["ecbzxx"]:
            current_state = state_result_json["data"]["bzclxx"][0]["ecbzxx"][0]["blztmc"]
            validity_period = state_result_json["data"]["bzclxx"][0]["ecbzxx"][0]["yxqz"]
        else:
            current_state = state_result_json["data"]["bzclxx"][0]["bzxx"][0]["blztmc"]
            validity_period = state_result_json["data"]["bzclxx"][0]["bzxx"][0]["yxqz"]
        apply_id_old = state_result_json["data"]["bzclxx"][0]["bzxx"][0]["applyId"]
        return current_state,validity_period,apply_id_old

    def autoRenew(self, payload):
        renew_result_json = self.request(self.inster_apply_record_url, payload)
        status_code = renew_result_json["code"]
        msg = renew_result_json["msg"]
        print(f"续签接口状态码：{status_code}")
        print(f"续签接口响应消息：{msg}")

    def main(self):
        current_state,validity_period,apply_id_old = self.getRemainingTime()
        self.payload["applyIdOld"] = apply_id_old
        payload = json.dumps(self.payload)
        if current_state == "审核通过(生效中)":
            today = datetime.now().strftime("%Y-%m-%d")
            if validity_period == today:
                print("剩余时间小于1天，执行续签")
                self.autoRenew(payload)
            else:
                print(f"剩余时间大于1天，无法续签，到期时间：${validity_period}")
        elif current_state == "审核通过(待生效)":
            print("审核通过(待生效),无需重新申请")
        else:
            self.autoRenew(payload)
AutoRenewTrafficPermit().main()  

、、、


## Telegram Bot 配置




## Docker 更新





## 意外发生：服务器封锁了HTTP端口




## 小结
