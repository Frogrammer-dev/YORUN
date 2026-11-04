# v18 조건부 검색: 원본 그림 IMAGE query 대 손그림 prototype 대 기하 점수

현재 종 분류기는 사람이 강아지로 읽은 도로를 chair로 분류해제외했다. 다음가설은종전체를강제예측하는대신이미알고있는요청그림의image특징과도로image특징을직접비교하면더읽히는후보를고를수있다는것이다. v15의목표외곽모호함은남으며cosine상승을사물인식으로간주하지않는다.

## 고정 입력과 모델

원본 diversity-v11.json1003행·25종×3지역75요청을유지한다. 요청별같은 area/proposalShape 안에서 geometryKey(무방향간선집합)를중복제거하고사전순최소sourceID를대표로고정한다. 대표와원래배치각을점수관찰전에고정해방법별best-of-views를금지한다. 원래좌표·노드/간선·거리3–8km·반복<=.2·영역·점수식은바꾸지않는다. canonical road view0 캐시와같은렌더러/encoder/processor만쓴다.

G는대표풀의원래generatorSimilarity최대,rowID동률 top1이다. 기존v11 first8/75는별도참고이며대표풀G와동일하다고가정하지않는다.

H는v17의train-only canonical 손그림prototype_weights의요청범주벡터와도로view0의cosine최대top1이다. class argmax·generic우승·margin거절을쓰지않는다.24종지원이며자료없는rocket3요청은명시적으로G를그대로사용한다. fallback을손그림prototype성공으로부풀리지않는다.

I는원래25종참고외곽을`sketch-features.render([points],turn=0)`로그린image의정규화CLIPembedding과같은도로view0의cosine최대top1이다.25종/rocket도포함한다. 새가중치학습·사람/AIlabel fitting·encoder fine-tuning·새모델다운로드는없다. query는원래외곽그대로이며성공case를보고수정하지않는다. 원래캐시의snapshot과로컬weight/processor파일hash를대조한다. revision=null만으로가중치동일성을주장하지않는다.

세방법모두같은풀·같은canonical표시·같은추천수(75개)를유지하며거절을적용하지않는다. H는거절제거/조건부검색과query원본image의효과를구분하는대조다. cosine는probability나사람읽힘확률이아니다. 모든방법동률은sourceID사전순이다. score로대표pose를바꾸거나표시방향을다시고르지않는다.

## 검증과 사전 판정

source/cache/catalog/protocol/code/queryfeatures의해시와행순서·cache호환을확인한다. 원본간선검증이된1003행의불변성·75슬롯·선택ID·GPX를검사한다. 학습/거절이없으므로75개를강제제공하는조건임을명시한다.미지원/결측을조용히삭제하지않는다.

기존primary와동일보조2AI를고정한다. 이름/참고query/방법/점수를숨긴중립이미지자유명명이며동일보디pixel만판정재사용한다. I의주개발지지기준은primary에서G보다target-clear>=5/75증가,그중동물>=3요청·2종이다. H와G각각에대한차이도보존한다. 다수결보조는>=13/75와원래엄격다양성gate(동물3종/사물3종각2지역)를적용한다. primary실패를보조성과로대체하지않는다. 모델전체일반화·최종목표에는별도독립실제사람근거가필요하다.

사람확인된울산dog-4는동기가된개발sanitycheck다. 재선택되거나분류명과일치해도새독립성공으로세지않고해당요청제외74조건도병기한다. 같은개발3지역·기존AI반복노출·조건부query효과를명시한다. 사람/AI정답을안뒤G/H/I중좋은방식을주방법으로바꾸지않는다. 주방법은I다.

실패하면query/seed/동의어/회전/threshold를이결과에맞춰재조정하지않는다. 기존v16사람명확개발사례·실패보고·원래12조건·점수식·holdout-v2·앱기본은보존한다. 새모델이성공했다고선언하기전에학습과독립평가를분리한다.
