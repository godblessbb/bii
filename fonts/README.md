`caihua-glyph.woff2` 是 Noto Sans SC（Black 900）只含「菜」「花」两个字的子集（约 1.3 KB），
用来在 WebGL 里采样粒子字形，保证任何系统上都能聚出同一个字形。
字体按 SIL Open Font License 1.1 授权：https://openfontlicense.org

`wenkai-fuji.woff2` 是霞鹜文楷 Lite（LXGW WenKai Lite v1.522 Regular）按《普通人如何去拥有富士山呢？》全文 + 页面标题、简介 + ASCII 切出的子集（约 124 KB，572 字），
只给这篇纸页随笔用；微博合辑那份子集在 `_preview/weibo-v2/fonts/wenkai-weibo.woff2`，缺这篇里的 80 来个字。
同样按 SIL Open Font License 1.1 授权，授权全文见 `_preview/weibo-v2/fonts/OFL.txt`。

`wenkai-baibian.woff2` 是同一款霞鹜文楷 Lite（v1.522 Regular）按百变动态合集 `baibian.md` 全文 + 页面标题、简介 + ASCII 切出的子集（约 273 KB，1295 字）。
微博那份子集是 v1.250、只按微博合辑切的，这篇有 300 多个字不在里面，退回系统楷体/宋体后同一段里字体会不一样。
`wenkai-gb/` 是同一款霞鹜文楷 Lite（v1.522）按 GB2312 全部 7445 个字符切成的 38 片（每片 200 字、约 50 KB，共约 1.9 MB），
声明在 `css/wenkai-gb.css`（生成文件，勿手改）。每篇的小子集排在字体栈最前面，缺的字才落到这里，而且浏览器只下载真用到的那一片。
所以在网页里改文章加了新字也不用重切子集；只有 GB2312 以外的生僻字才会退回系统字体，编辑器会提示是哪几个。
