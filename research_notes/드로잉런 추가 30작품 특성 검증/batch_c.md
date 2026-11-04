# 비아시아 개인 포트폴리오와 단순 윤곽 반례 검증 (C)

## 추가 작품에 내부 획·부분 관계·장거리가 공통인가

### Takeaway
직접 본 10개 중 단순 외곽만 보이는 사례는 공룡(C03)과 빅버드(C04) 두 개다. 백조(C09)는 실제 4.79mi(약7.71km) 카드에 내부 날개 획이 있어, 내부 획을 장거리의 전유물로 보는 해석을 반박한다.

### Cited Findings
아래의 예/아니오는 픽셀 외관 관찰이며, 제목을 본 뒤의 기술이다. 자료의 주행 원문과 이미지 링크는 동행 batch_c.json에 개별 보존했다.

|ID|작품|내부|열린/분기|부분관계|단순 닫힌 외곽|거리km|근거|
|---|---|---|---|---|---|---|---|
|C01|Shrimply the Best|no|yes|yes|no|미상|[원문](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028)|
|C02|Royal Parkyderm|yes|yes|yes|no|미상|[원문](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028)|
|C03|Brontosaurun|no|no|yes|yes|미상|[원문](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028)|
|C04|Big Bird Trail — Mount Martha|no|no|yes|yes|9.000|[원문](https://www.mpnews.com.au/2024/09/04/the-art-of-jogging-with-big-bird/)|
|C05|제목 미상 — Claire Wyckoff 기사 헤더의 장축 도형|yes|yes|uncertain|no|미상|[원문](https://stoppress.co.nz/news/art-running/)|
|C06|Christmas Tree — 2014-12-21|yes|yes|yes|no|8.948|[원문](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2014/)|
|C07|Star! — Glens Falls NY, 2015-05-21|no|yes|no|no|9.543|[원문](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2015/)|
|C08|Smurf’s Hat — 2015-07-25|no|yes|yes|no|8.948|[원문](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2015/)|
|C09|Swan — 2015-10-20|yes|yes|yes|no|7.709|[원문](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2015/)|
|C10|Cat — 2015-04-07|no|yes|yes|no|9.543|[원문](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2015/)|

- [ABC의 본인 제공 경로와 인터뷰](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028): 공룡은 목·머리·몸통·다리·꼬리가 단일 외곽에 존재한다. 코끼리의 내부 귀·열린 꼬리, 새우의 다리·더듬이는 다른 구조다. 시작 마커는 눈 획으로 세지 않았다.
- [Peter Mitchell 인터뷰와 제공 사진](https://www.mpnews.com.au/2024/09/04/the-art-of-jogging-with-big-bird/): 실제 그룹 러닝에서 시작한 약9km 빅버드의 왼쪽 GPS 외곽만 분류했다. 오른쪽 만화의 눈·깃털은 제외했다.
- [Tom의 2014 포트폴리오](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2014/) 및 [2015 포트폴리오](https://tomveilleux.wordpress.com/2017/07/31/drawwithyourfeet-2015/): 다섯 사례 모두 MapMyRun 카드의 Activity: Run과 mi 단위를 픽셀로 확인했다. 별은 닫힌 오각별 대신 방사형 열린 획이다. 모자와 고양이는 주된 외곽 외 접근선이 붙는다. 백조4.79mi는7.708758km다.
- [Claire 기사](https://stoppress.co.nz/news/art-running/)의 헤더는 Nike+ 실제 경로로 제시되지만 개별 작품 제목·원활동을 확인하지 못했다. 실행 근거가 다른 사례보다 약하므로 원Run카드를 확보한 예비 사례가 있으면 본30에서 대체하는 편이 타당하다.

### Inferences
- 내부 획의 필요성과 단순/복합, 거리, 실제 반복을 독립 축으로 평가해야 한다.
- 단순 고리 탐색은 일부 동물·캐릭터에도 유효하다. 모든 작품에 복합 획 모델을 강제할 근거는 없다.
- 전체 궤적에는 미술 부분 외 접근선이 섞일 수 있다. 접근선을 포함한 전체 유사도와 작품의 핵심 윤곽 유사도를 별도로 진단하되, 실제 주행선은 보존해야 한다.
- 내부 특징이 필요한 대상은 전체 윤곽과 부분 배치, 열린 획을 함께 점수화하는 후보 모델을 시험할 이유가 있다. 본 관찰은 그 모델의 우월성을 입증하지 않는다.

### Gaps
원 GPX를 확보하지 않아 도로 그래프상 실제 분기·연속성·왕복률·일시정지를 검증하지 못했다. 픽셀 교차를 실제 왕복으로 바꾸지 않았다. 작가 일반 GPS 정책을 특정 작품 pause 사실로 옮기지 않았다. 제목을 미리 보았으므로 사람 블라인드 인식률과 기존80점 목표의 성과는 측정하지 않았다.

## 무엇을 어떤 순서로 골랐고 무엇을 제외했나

### Takeaway
짧고 단순한 반례를 먼저 찾았으나 검색 결과에는 실행되지 않은 상용 계획 경로가 많았다. 검증 가능한 원본이 나온 포트폴리오를 따라 수집했으며, 5개가 Tom이라는 군집 편향을 공개한다.

### Cited Findings
1. `running GPS art 5km heart runner`, `GPS art running simple shapes 5k` 검색: CityHeart/ShapeMiles/Motera/ArtTrails/Kakeru 등 계획 경로·앱 설명은 실주행 근거가 없어 모두 제외. [예: 계획 Leipzig heart5.5km](https://www.cityheart.run/routes/running-heart-leipzig/).
2. 개인작가 검색에서 [ABC 인터뷰](https://www.abc.net.au/news/2022-06-05/runners-and-cyclists-use-apps-to-create-gps-art/101001028) 발견. 기사의 순서대로 새우→코끼리→Manrattan→공룡→토끼 확인. 새우·코끼리·공룡을 채택하고 Manrattan은 지연 이미지로 전경로 미관찰, 토끼는 작가 군집을 더 늘리지 않기 위해 본10에 미포함. 기사 후반 Pravin Xeona 작품은 Ride이고 중단 기록 기법까지 혼재해 제외.
3. [MPNews 인터뷰](https://www.mpnews.com.au/2024/09/04/the-art-of-jogging-with-big-bird/) 발견, BigBird9km와 원이미지 왼쪽 주황 GPS 경로 확인. 뉴질랜드 작품은 A 예약으로 제외.
4. [Tom의 소개](https://tomveilleux.wordpress.com/2017/07/30/drawwithyourfeet-an-introduction/)에서 본인 실제 러닝 기록이라는 설명 확인. 소개 안 Highlights 삽화는 GPS 작품이 아니므로 제외.
5. strav.art의 짧음/단순 후보 확인: Gino Bonte `LOCKDOWN30MIN`(3603425026), Ronald Chen `JOGGED A WEE SPARROW/PIGEON?`(6176942760)은 그림과 갤러리Run분류만 확인. Gino 원활동은 가입 페이지로 이동하며 activity not found라 더 접근하지 않았다. R3 두 개는 본10 미포함. Tony Idler `UNINTENTIONAL DOVE`(3213608360)는 단순 윤곽이나 Ride여서 제외. [갤러리](https://www.strav.art/birds/).
6. [Claire 기사](https://stoppress.co.nz/news/art-running/)의 헤더 픽셀 확인, 소재와 활동 연결이 충분하지 않아 weakR2로 명시.
7. Tom의2014 연도 글 첫 작품 ChristmasTree와 카드 확인. Menorah는 일부 맵/보조삽화 혼합이라 조사했어도 본10 미포함.
8. Tom의2015 연도 글에서 단순 윤곽을 의도적으로 찾으며 Star→SmurfHat→Swan→Cat의 원카드와 전체 경로를 확인. 관찰 순서대로 C07~C10 부여, 다른 2015 작품을 유리한 특성 때문에 교체하지 않음.

### Inferences
이것은 검색·작가 포트폴리오에 접근 가능한 성공작을 목적 표집한 사례 분석이다. 실제 드로잉런 전체의 빈도, 사용자의 선호, 인식 정확도 추정 표본은 아니다. 영어권·공개 이미지·포트폴리오·작가 군집 편향이 있다. 반례 탐색 자체도 특정 형태를 우선 찾는 선택이므로 수치의 모집단 일반화를 피해야 한다.

### Gaps
비공개/삭제 활동의 실행을 독립 확인하지 못했다. 정확 거리 미상은 null로 유지했으며 기사 20km훈련 언급을 각동물 거리로 복사하지 않았다.

## 교차 확인과 알고리즘 설계에 주는 범위

### Takeaway
A 연구자가 C02·C03·C08을 독립적으로 다시 보아 최종 코딩 전항목에 동의했다. 이것은 동일 AI 계열의 일치 확인이며 사람이 무엇으로 읽는지 평가한 결과가 아니다.

### Cited Findings
- A 재관찰은 C03단순 윤곽, C02내부 귀/꼬리, C08접근선과 경계 밖 작은 고리를 구분했다. [공룡](https://live-production.wcms.abc-cdn.net.au/bf285dca794a44745d955f5907c5021f?cropH=601&cropW=901&height=575&impolicy=wcms_crop_resize&width=862&xPos=0&yPos=92), [코끼리](https://live-production.wcms.abc-cdn.net.au/5692bfb04daa26db36538355b7356892?cropH=678&cropW=1017&height=575&impolicy=wcms_crop_resize&width=862&xPos=302&yPos=0), [모자](https://tomveilleux.wordpress.com/wp-content/uploads/2017/07/0028-1.png?w=746&h=1104). 별도 cross_a.md에 기록 예정.
- C의 B 교차 결과는 cross_c.md에 따로 저장하며 원 batch_b.json을 수정하지 않는다.

### Inferences
검증할 설계 범위는 단순 고리 탐색을 버리는 전면 교체보다, 전체 윤곽·특징 관계를 강화하고 필요한 대상에서만 내부/열린 획 후보를 추가하는 방식이다. 짧은 복합 사례가 있으므로 먼저 거리 제한을 넓히는 것만으로 해결된다고 볼 수 없다.

### Gaps
동일 예산에서 기존 생성기와 새 생성기를 직접 비교하지 않았다. 사람이 이름 없이 원경로를 분류하는 평가와 접근선·장식선 공개에 따른 도움 효과가 다음 검증 과제로 남는다.

