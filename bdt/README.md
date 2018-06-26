# BDT

P2P协议实现.


# 开发

快速批量删除 bdt主要逻辑文件中的blog

```
 find . -name '*.js' | grep -v node_modules | grep -v  test| grep -v base | xargs sed -i '/blog\..*(.*);/d'
```
