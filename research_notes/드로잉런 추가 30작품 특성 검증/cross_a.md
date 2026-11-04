# A 관찰자의 C 3작품 교차 확인

## 1. 확인 범위와 방법

### Takeaway

2026-10-21 C가 공유한 C03 단순 윤곽, C02 내부선, C08 미세 경계가 있는 3이미지를 A가 새로 열어 픽셀을 확인했다. C08은 위아래를 모두 스크롤해 전체 경로를 보았다. 동일 AI 계열이며 사전 제목·원 코딩을 알고 있으므로 독립 사람 평가나 블라인드 신뢰도 실험은 아니다.

### Cited Findings

- C03 Brontosaurun: [기사](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028), [확인 이미지](https://live-production.wcms.abc-cdn.net.au/bf285dca794a44745d955f5907c5021f?cropH=601&cropW=901&height=575&impolicy=wcms_crop_resize&width=862&xPos=0&yPos=92).
- C02 Royal Parkyderm: [기사](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028), [확인 이미지](https://live-production.wcms.abc-cdn.net.au/5692bfb04daa26db36538355b7356892?cropH=678&cropW=1017&height=575&impolicy=wcms_crop_resize&width=862&xPos=302&yPos=0).
- C08 Smurf Hat: [본인 포트폴리오](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2015/), [확인 이미지](https://tomveilleux.wordpress.com/wp-content/uploads/2017/07/0028-1.png?w=746&h=1104). 이미지에는 Run·5.56 mi 카드가 함께 보인다.

### Gaps

원 GPX·실제 주행 순서·세그먼트별 왕복은 재검증하지 않았다.

## 2. 분류 일치와 관찰 근거

### Takeaway

C의 최종 코딩과 3개 모두 5필드가 일치했다. C08의 최초 상단 부분 관찰만으로는 접근 획을 놓칠 수 있었고 전체 아래쪽을 확인한 뒤 단일 윤곽 no에 동의했다.

### Cited Findings

| 작품 | internal | branch/open | parts | angular | simple | A의 관찰 근거 |
|---|---|---|---|---|---|---|
| C03 Brontosaurun | no | no | yes | yes | yes | 붉은 경로의 닫힌 공룡 윤곽. 머리·긴 목·몸통·꼬리·다리는 단일 실루엣 안에서도 상대 배치가 보인다. 계단형 꼬리/등이 있다. [이미지](https://live-production.wcms.abc-cdn.net.au/bf285dca794a44745d955f5907c5021f?cropH=601&cropW=901&height=575&impolicy=wcms_crop_resize&width=862&xPos=0&yPos=92) |
| C02 Royal Parkyderm | yes | yes | yes | yes | no | 귀를 나누는 안쪽 큰 U자 획, 왼쪽 긴 코, 아래 다리, 오른쪽 열린 꼬리가 붉은 경로에 보인다. 출발 체크 마커는 눈으로 세지 않았다. [이미지](https://live-production.wcms.abc-cdn.net.au/5692bfb04daa26db36538355b7356892?cropH=678&cropW=1017&height=575&impolicy=wcms_crop_resize&width=862&xPos=302&yPos=0) |
| C08 Smurf Hat | no | yes | yes | uncertain | no | 모자 꼭대기와 앞으로 뻗은 챙, 왼쪽 아래 출발 마커로 이어지는 짧은 열린 접근 획을 확인. 작은 상단 고리는 경계 바깥에 붙어 보이며 커다란 모자 내부선으로 세지 않는다. 굵은 빨간 선 때문에 미세 도로 꺾임은 uncertain. [이미지](https://tomveilleux.wordpress.com/wp-content/uploads/2017/07/0028-1.png?w=746&h=1104) |

### Inferences

단순 폐윤곽 여부와 부분 관계는 배타적인 분류가 아니다. 공룡처럼 단일 윤곽으로도 머리·목·다리의 배치를 표현할 수 있다. 분기에는 의미 부분뿐 아니라 짧은 접근 획도 있으므로 branch yes만으로 인식 품질을 대체하면 안 된다.

### Gaps

두 AI 코딩의 일치는 일반화 성능·사람 인식률·각 특징의 인과적 필요성을 뜻하지 않는다.

## 3. A 자체 사례의 교차 후 변경 기록

### Takeaway

B가 A04·A08·A10을 따로 확인했고, 지적한 부분을 A가 다시 열어 관찰한 뒤 A04와 A08의 코딩을 정정했다.

### Cited Findings

- A04 USA: 오대호 부근에 작은 고리·교차처럼 보이는 구간이 있어 internal/branch/simple을 no/no/yes에서 uncertain/uncertain/uncertain으로 정정. 윤곽 중심의 짧은 작품임은 유지한다. [이미지](https://d3o5xota0a1fcr.cloudfront.net/v6/maps/YAVF7OJI77BAOL25ME2HRQP2FFORJTAKPHD3KSKL66ZGAAWLGQGL2COOQJMKQ7XFC3AHR2DFSVLJA6PIDMZNG===).
- A08 World: 아프리카·남아메리카 외곽 안을 가로지르는 검은 경로 연결 선을 다시 확인하여 internal uncertain에서 yes로 정정. 이 연결 획이 의미 세부 특징이라는 주장은 하지 않는다. [이미지](https://d3o5xota0a1fcr.cloudfront.net/v6/maps/5PDB7NLD4LBYN5GW572MTUPZ3MLAMHIKBPDETOXQRDSC2VMAU7JOOFQ5FX5AAQSO63YQ3F2I3TZUM4MLEX7YW===).
- A10 Thumbs up: 내부 커프 선·분기·부분 관계 yes, simple no에 양 관찰자가 동의. [이미지](https://d3o5xota0a1fcr.cloudfront.net/v6/maps/NHYE2CG3MLMZAFR6OE5WHMEFPAHLJLSLMESWMRJWZTJDOXNEKJTUD2VDTMRCEHZHUHKK2JNUHEOKHLLC7ECC2===).

### Gaps

교차 전후 기록은 판정의 불확실성을 보존하려는 절차이며, 합의 자체가 정답을 증명하지 않는다.
